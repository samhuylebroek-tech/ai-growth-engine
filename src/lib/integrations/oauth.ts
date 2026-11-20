// OAuth helpers for read-only Google connections. Pure Web Crypto, safe on the Worker runtime.
const enc = new TextEncoder();
export const b64url = (bytes: Uint8Array) =>
  btoa(String.fromCharCode(...bytes))
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");
export const b64 = (s: string) => b64url(enc.encode(s));
export const unb64 = (s: string) =>
  new TextDecoder().decode(
    Uint8Array.from(atob(s.replace(/-/g, "+").replace(/_/g, "/")), (c) => c.charCodeAt(0)),
  );

export async function hmac(secret: string, data: string): Promise<string> {
  const key = await crypto.subtle.importKey(
    "raw",
    enc.encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  return b64url(new Uint8Array(await crypto.subtle.sign("HMAC", key, enc.encode(data))));
}

/** Compares without stopping at the first difference, so timing reveals nothing about a signature. */
export function safeEqual(a: string, b: string): boolean {
  const x = enc.encode(a),
    y = enc.encode(b);
  let diff = x.length ^ y.length;
  for (let i = 0; i < Math.max(x.length, y.length); i++) diff |= (x[i] ?? 0) ^ (y[i] ?? 0);
  return diff === 0;
}

/**
 * The return address for Google sign-in comes only from the server's own list (APP_PUBLIC_ORIGINS),
 * never from what the browser sends; otherwise a forged origin could receive the authorization code.
 */
export function allowedRedirectOrigin(
  requested: string,
  allowlist: string | undefined,
): string | null {
  let origin: string;
  try {
    origin = new URL(requested).origin;
  } catch {
    return null;
  }
  const allowed = (allowlist ?? "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean)
    .flatMap((s) => {
      try {
        return [new URL(s).origin];
      } catch {
        return [];
      }
    });
  return allowed.includes(origin) &&
    (origin.startsWith("https://") || /^http:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(origin))
    ? origin
    : null;
}

/** PKCE (RFC 7636, S256): the verifier stays in an HttpOnly cookie in this browser; only its hash goes to Google. */
export async function pkcePair(): Promise<{ verifier: string; challenge: string }> {
  const verifier = b64url(crypto.getRandomValues(new Uint8Array(48)));
  const challenge = b64url(
    new Uint8Array(await crypto.subtle.digest("SHA-256", enc.encode(verifier))),
  );
  return { verifier, challenge };
}
export async function pkceChallenge(verifier: string): Promise<string> {
  return b64url(new Uint8Array(await crypto.subtle.digest("SHA-256", enc.encode(verifier))));
}

export type GoogleState = {
  u: string;
  w: string;
  c: "google_analytics" | "search_console";
  p: string;
  r: string;
  e: number;
  n: string;
};
export async function signState(secret: string, s: GoogleState): Promise<string> {
  const payload = b64(JSON.stringify(s));
  return `${payload}.${await hmac(secret, payload)}`;
}
/** Returns the state only when the signature matches and it has not expired. */
export async function verifyState(
  secret: string,
  state: string,
  now = Date.now(),
): Promise<GoogleState | null> {
  const [payload, sig, extra] = state.split(".");
  if (!payload || !sig || extra !== undefined || !safeEqual(sig, await hmac(secret, payload)))
    return null;
  try {
    const s = JSON.parse(unb64(payload)) as GoogleState;
    return typeof s.e === "number" && now <= s.e ? s : null;
  } catch {
    return null;
  }
}
