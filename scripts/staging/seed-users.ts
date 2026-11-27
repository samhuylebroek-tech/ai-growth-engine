// Staging-only test accounts and organizations (no Platform Owner; see owner-init.ts).
// Passwords are random, written only to /tmp/staging/users.json (mode 600) and never printed.
// Re-running rotates the passwords and leaves everything else unchanged.
import { mkdirSync, writeFileSync, chmodSync } from "node:fs";
import { randomBytes, randomUUID } from "node:crypto";
import { connectStaging } from "./db";

const USERS = [
  { key: "owner", email: "qa-owner@staging.example.com", name: "QA Owner" },
  { key: "admin", email: "qa-admin@staging.example.com", name: "QA Admin" },
  { key: "member", email: "qa-member@staging.example.com", name: "QA Member" },
  { key: "viewer", email: "qa-viewer@staging.example.com", name: "QA Viewer" },
  { key: "outsider", email: "qa-outsider@staging.example.com", name: "QA Outsider" },
] as const;

const { sql } = await connectStaging();
const out: Record<string, { id: string; email: string; password: string }> = {};
await sql.begin(async (tx) => {
  for (const u of USERS) {
    const password = randomBytes(18).toString("base64url");
    const [existing] = await tx`select id from auth.users where email = ${u.email}`;
    let id: string = existing?.id;
    if (id) {
      await tx`update auth.users set encrypted_password = extensions.crypt(${password}, extensions.gen_salt('bf')), updated_at = now() where id = ${id}`;
    } else {
      id = randomUUID();
      await tx`insert into auth.users (instance_id, id, aud, role, email, encrypted_password, email_confirmed_at, raw_app_meta_data, raw_user_meta_data, created_at, updated_at, confirmation_token, recovery_token, email_change_token_new, email_change)
        values ('00000000-0000-0000-0000-000000000000', ${id}, 'authenticated', 'authenticated', ${u.email}, extensions.crypt(${password}, extensions.gen_salt('bf')), now(),
          ${sql.json({ provider: "email", providers: ["email"], staging_test_user: true })}, ${sql.json({ full_name: u.name })}, now(), now(), '', '', '', '')`;
      await tx`insert into auth.identities (provider_id, user_id, identity_data, provider, last_sign_in_at, created_at, updated_at)
        values (${id}, ${id}, ${sql.json({ sub: id, email: u.email, email_verified: true })}, 'email', now(), now(), now())`;
    }
    out[u.key] = { id, email: u.email, password };
  }
  const as = async (userId: string, fn: () => Promise<unknown>) => {
    await tx`select set_config('request.jwt.claims', ${JSON.stringify({ sub: userId, role: "authenticated" })}, true)`;
    await tx`set local role authenticated`;
    try {
      return await fn();
    } finally {
      await tx`reset role`;
    }
  };
  // Organizations through the same function the app uses, acting as the user.
  const orgOf = async (userId: string, name: string, ws: string) => {
    const [o] =
      await tx`select id from public.organizations where created_by = ${userId} and name = ${name}`;
    if (o) return o.id as string;
    let id = "";
    await as(userId, async () => {
      const [r] = await tx`select public.create_organization(${name}, ${ws}) as id`;
      id = r.id;
    });
    return id;
  };
  const org = await orgOf(out.owner!.id, "Staging Bakery", "Main workspace");
  await orgOf(out.outsider!.id, "Staging Rival Co", "Rival workspace");
  const [ws] =
    await tx`select id from public.workspaces where org_id = ${org} order by created_at limit 1`;
  for (const [key, role] of [
    ["admin", "admin"],
    ["member", "member"],
    ["viewer", "viewer"],
  ] as const) {
    await tx`insert into public.organization_members(org_id, user_id, role) values (${org}, ${out[key]!.id}, ${role}) on conflict do nothing`;
    await tx`insert into public.workspace_members(workspace_id, user_id, role) values (${ws.id}, ${out[key]!.id}, ${role}) on conflict do nothing`;
  }
  // The Platform Owner is never inserted here: it is assigned only by the one-time
  // initialization (proposal 0058) via scripts/staging/owner-init.ts.
});
const [s] =
  await sql`select (select count(*)::int from auth.users) as users, (select count(*)::int from public.organizations) as orgs,
  (select count(*)::int from public.platform_roles where role='platform_owner') as platform_owners, (select count(*)::int from public.organization_members) as memberships`;
await sql.end();
mkdirSync("/tmp/staging", { recursive: true, mode: 0o700 });
writeFileSync("/tmp/staging/users.json", JSON.stringify(out), { mode: 0o600 });
chmodSync("/tmp/staging/users.json", 0o600);
console.log(
  JSON.stringify({
    ...s,
    accounts: Object.fromEntries(Object.entries(out).map(([k, v]) => [k, v.email])),
  }),
);
