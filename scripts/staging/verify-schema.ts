// Read-only structural checks after migration.
import { connectStaging } from "./db";
import { readMigrationFiles } from "drizzle-orm/migrator";

const { sql } = await connectStaging();
const files = readMigrationFiles({ migrationsFolder: "drizzle/migrations" });
const rows = await sql`select hash, created_at from drizzle.__drizzle_migrations order by created_at`;
const hashMatch = files.length === rows.length && files.every((f, i) => f.hash === rows[i].hash && String(f.folderMillis) === String(rows[i].created_at));
const [t] = await sql`select count(*)::int n from pg_tables where schemaname='public'`;
const noRls = await sql`select tablename from pg_tables where schemaname='public' and not rowsecurity order by 1`;
const noGrant = await sql`select c.relname from pg_class c join pg_namespace n on n.oid=c.relnamespace where n.nspname='public' and c.relkind='r' and not has_table_privilege('authenticated', c.oid, 'select') order by 1`;
const growth = await sql`select table_name from information_schema.tables where table_schema='public' and table_name in ('growth_plan_versions','growth_initiatives','growth_initiative_operations') order by 1`;
const uq = await sql`select conname from pg_constraint where conrelid='public.growth_initiatives'::regclass and contype='u'`;
const fns = await sql`select count(*)::int n from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public'`;
const definerNoPath = await sql`select p.proname from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and p.prosecdef and not exists (select 1 from unnest(coalesce(p.proconfig,'{}')) c where c like 'search_path=%') order by 1`;
const trig = await sql`select tgname from pg_trigger where tgrelid='auth.users'::regclass and not tgisinternal`;
const pol = await sql`select count(*)::int n from pg_policies where schemaname='storage' and tablename='objects'`;
console.log(JSON.stringify({ migrationFiles: files.length, ledgerRows: rows.length, hashMatch, publicTables: t.n, tablesWithoutRls: noRls.map((r) => r.tablename), tablesWithoutAuthenticatedSelect: noGrant.map((r) => r.relname), growthTables: growth.map((r) => r.table_name), initiativeUniqueConstraints: uq.map((r) => r.conname), publicFunctions: fns.n, securityDefinerWithoutSearchPath: definerNoPath.map((r) => r.proname), authUserTriggers: trig.map((r) => r.tgname), storagePolicies: pol.n }, null, 1));
await sql.end();
