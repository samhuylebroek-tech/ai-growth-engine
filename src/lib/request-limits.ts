// Request body limits (pure, unit tested). Server functions only take small JSON inputs (every text field is capped
// well below 10,000 characters; files go straight to private storage), so a body above MAX_BODY_BYTES can only be
// abuse. Refusing it before parsing protects the validation library from oversized inputs (zod < 4.6.6 builds one
// issue object per failing array element, GHSA-mrhx-c7xc-m3w5) and keeps one request from exhausting a worker's
// memory. A server-function body without a declared length is refused too, because it cannot be bounded before
// reading; browsers always declare it for the app's own calls.
export const MAX_BODY_BYTES = 1_000_000;

export type BodyLimitRefusal = { status: 411 | 413; reason: string };

export function bodyLimitRefusal(method: string, headers: Pick<Headers, "get">, handlerType: "serverFn" | "router", max = MAX_BODY_BYTES): BodyLimitRefusal | null {
  const m = method.toUpperCase();
  if (m === "GET" || m === "HEAD" || m === "OPTIONS") return null;
  const raw = headers.get("content-length");
  if (raw === null || raw.trim() === "") {
    // A body sent in chunks has no length; only server functions are refused, pages never take a body.
    return handlerType === "serverFn" && headers.get("transfer-encoding") !== null ? { status: 411, reason: "body length required" } : null;
  }
  if (!/^\d+$/.test(raw.trim())) return { status: 413, reason: "invalid body length" };
  return Number(raw) > max ? { status: 413, reason: "body too large" } : null;
}
