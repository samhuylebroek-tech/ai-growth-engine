// Read-only report of anon/authenticated privileges that exceed what RLS policies allow.
import { connectStaging } from "./db";
const { sql } = await connectStaging();
const anonTables = await sql`select c.relname, (select count(*)::int from pg_policies p where p.schemaname='public' and p.tablename=c.relname and 'anon'=any(p.roles)) anon_policies,
  (select count(*)::int from pg_policies p where p.schemaname='public' and p.tablename=c.relname and 'public'=any(p.roles)) public_policies
  from pg_class c join pg_namespace n on n.oid=c.relnamespace where n.nspname='public' and c.relkind='r' and has_table_privilege('anon',c.oid,'select,insert,update,delete') order by 1`;
const anonFns = await sql`select p.proname, p.prosecdef from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and has_function_privilege('anon',p.oid,'execute') and p.prorettype <> 'trigger'::regtype order by 1`;
console.log(JSON.stringify({ anonTables, anonCallable: anonFns.map((f) => f.proname + (f.prosecdef ? "*" : "")) }));
await sql.end();
