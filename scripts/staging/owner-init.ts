// Staging only. Formal one-time Platform Owner initialization (proposal 0058).
//   retire-direct : before 0058 exists, removes the Platform Owner row that seed-users.ts once inserted
//                   directly, after checking nothing depends on it; the removal itself is audited and the
//                   original audit row stays.
//   run           : step 1 as the person (signed-in session → request; identity from the session only),
//                   step 2 as controlled administration (database owner) with the confirmed id + email.
// No password, token or key is printed.
import { readFileSync } from "node:fs";
import { connectStaging } from "./db";
import { STAGING_URL } from "./app-env";

const mode = process.argv[2];
const users = JSON.parse(readFileSync("/tmp/staging/users.json", "utf8")) as Record<string, { id: string; email: string; password: string }>;
const owner = users.owner!;
const { sql } = await connectStaging();

if (mode === "retire-direct") {
  const [guard] = await sql`select to_regclass('public.platform_owner_initialization') is not null as has`;
  if (guard.has) throw new Error("0058 is already applied; direct rows can no longer be removed");
  const deps = await sql`select conrelid::regclass::text as t from pg_constraint where confrelid = 'public.platform_roles'::regclass`;
  if (deps.length) throw new Error("rows depend on platform_roles; stopping");
  await sql.begin(async (tx) => {
    const rows = await tx`select pr.id, pr.user_id from public.platform_roles pr where pr.role = 'platform_owner'`;
    const [prev] = await tx`select id from public.audit_logs where action = 'platform_owner.initialized' order by id desc limit 1`;
    for (const r of rows) {
      await tx`insert into public.audit_logs(org_id, actor_id, action, target_type, target_id, metadata)
        values (null, null, 'platform_owner.retired_for_formal_initialization', 'user', ${r.user_id},
          ${sql.json({ environment: "staging", reason: "role had been inserted directly by a setup script, not by the one-time initialization", previous_audit_id: prev?.id ?? null })})`;
      await tx`delete from public.platform_roles where id = ${r.id}`;
    }
    console.log(JSON.stringify({ retired: rows.length }));
  });
} else if (mode === "run") {
  const key = process.env["STAGING_SUPABASE_PUBLISHABLE_KEY"]; if (!key) throw new Error("STAGING_SUPABASE_PUBLISHABLE_KEY is not set");
  const auth = await fetch(`${STAGING_URL}/auth/v1/token?grant_type=password`, { method: "POST", headers: { apikey: key, "content-type": "application/json" }, body: JSON.stringify({ email: owner.email, password: owner.password }) });
  if (!auth.ok) throw new Error(`staging sign-in failed (${auth.status})`);
  const { access_token } = await auth.json() as { access_token: string };
  const res = await fetch(`${STAGING_URL}/rest/v1/rpc/request_platform_owner_initialization`, { method: "POST", headers: { apikey: key, authorization: `Bearer ${access_token}`, "content-type": "application/json" }, body: "{}" });
  const req = await res.json() as { request_id?: string; user_id?: string; email?: string; message?: string };
  if (!res.ok || !req.request_id) throw new Error(`request refused: ${req.message ?? res.status}`);
  console.log(JSON.stringify({ step: "request from session", user_id: req.user_id, email: req.email }));
  // Confirmation: the session-derived identity must be exactly the designated staging owner account.
  if (req.user_id !== owner.id || req.email !== owner.email.toLowerCase()) throw new Error("session identity is not the designated staging owner; stopping");
  const [r] = await sql`select public.complete_platform_owner_initialization(${req.request_id}::uuid, ${owner.id}::uuid, ${owner.email}) as r`;
  console.log(JSON.stringify({ step: "completed by controlled administration", ...r.r }));
} else throw new Error("usage: owner-init.ts retire-direct|run");
await sql.end();
