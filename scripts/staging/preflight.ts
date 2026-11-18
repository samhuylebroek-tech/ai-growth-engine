// Preflight: verify target, then (only on an empty database) create the identity marker.
import { connectStaging } from "./db";
import { STAGING_REF } from "./target";

const { sql, target, hasMarker } = await connectStaging({ allowUnmarked: true });
const [s] = await sql`select
  (select count(*)::int from information_schema.tables where table_schema='public') as public_tables,
  (select to_regclass('drizzle.__drizzle_migrations') is not null) as has_ledger,
  (select count(*)::int from auth.users) as users,
  (select count(*)::int from storage.buckets) as buckets,
  current_user as u`;
console.log(JSON.stringify({ ref: target.ref, host: target.host, port: target.port, user: s.u, publicTables: s.public_tables, ledger: s.has_ledger, authUsers: s.users, buckets: s.buckets, marker: hasMarker }));
if (!hasMarker) {
  if (s.public_tables !== 0 || s.has_ledger) throw new Error("database is not empty and has no marker; refusing");
  await sql.begin(async (tx) => {
    await tx`create schema ops_staging`;
    await tx`revoke all on schema ops_staging from public`;
    await tx`create table ops_staging.identity(ref text primary key, created_at timestamptz not null default now())`;
    await tx`insert into ops_staging.identity(ref) values (${STAGING_REF})`;
  });
  console.log("identity marker created");
}
await sql.end();
