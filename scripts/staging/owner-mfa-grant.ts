// Staging only: sign in as the QA Platform Owner, enroll + verify TOTP (secret kept in /tmp/staging, mode 600, never printed),
// then call the role- and MFA-checked admin_grant_credits once for the approved one-time grant (idempotent by note).
import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { createHmac } from "node:crypto";
import { createClient } from "@supabase/supabase-js";
import { STAGING_URL } from "./app-env";

const NOTE = "staging-testcredits-2026-11-24 (+200, approved)";
const key = process.env["STAGING_SUPABASE_PUBLISHABLE_KEY"]!;
const users = JSON.parse(readFileSync("/tmp/staging/users.json", "utf8"));
const sb = createClient(STAGING_URL, key, { auth: { persistSession: false } });
const b32 = (s: string) => {
  const a = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";
  let bits = "";
  for (const c of s.replace(/=+$/, "")) bits += a.indexOf(c).toString(2).padStart(5, "0");
  const out = [];
  for (let i = 0; i + 8 <= bits.length; i += 8) out.push(parseInt(bits.slice(i, i + 8), 2));
  return Buffer.from(out);
};
const totp = (secret: string) => {
  const c = Buffer.alloc(8);
  c.writeBigUInt64BE(BigInt(Math.floor(Date.now() / 30000)));
  const h = createHmac("sha1", b32(secret)).update(c).digest();
  const o = h[h.length - 1]! & 15;
  return String((h.readUInt32BE(o) & 0x7fffffff) % 1e6).padStart(6, "0");
};

const { error: e1 } = await sb.auth.signInWithPassword({
  email: users.owner.email,
  password: users.owner.password,
});
if (e1) throw new Error("sign-in failed: " + e1.message);
const file = "/tmp/staging/owner-totp.json";
let factorId: string, secret: string;
const { data: f } = await sb.auth.mfa.listFactors();
const verified = f?.totp?.find((x) => x.status === "verified");
if (verified && existsSync(file)) ({ factorId, secret } = JSON.parse(readFileSync(file, "utf8")));
else {
  for (const x of f?.all ?? []) await sb.auth.mfa.unenroll({ factorId: x.id });
  const { data, error } = await sb.auth.mfa.enroll({
    factorType: "totp",
    friendlyName: "staging-qa-" + Date.now(),
  });
  if (error) throw new Error("enroll failed: " + error.message);
  factorId = data.id;
  secret = data.totp.secret;
  writeFileSync(file, JSON.stringify({ factorId, secret }), { mode: 0o600 });
}
const { error: e2 } = await sb.auth.mfa.challengeAndVerify({ factorId, code: totp(secret) });
if (e2) throw new Error("mfa verify failed: " + e2.message);
const { data: org } = await sb
  .from("organizations")
  .select("id")
  .eq("name", "Staging Bakery")
  .single();
const { data: prior } = await sb
  .from("credit_ledger")
  .select("id")
  .eq("org_id", org!.id)
  .eq("ref", NOTE);
if (prior?.length) console.log("already granted");
else {
  const { error } = await sb.rpc("admin_grant_credits", {
    _org: org!.id,
    _amount: 200,
    _note: NOTE,
  });
  if (error) throw new Error("grant failed: " + error.message);
  console.log("granted 200");
}
const { data: led } = await sb.from("credit_ledger").select("delta").eq("org_id", org!.id);
console.log(
  "balance",
  (led ?? []).reduce((s, r: any) => s + r.delta, 0),
);
