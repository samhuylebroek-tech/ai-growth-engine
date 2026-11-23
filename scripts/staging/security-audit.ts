// Read-only security inventory of the staging database (no writes). Reports every item that needs a
// reviewer's decision; an empty list means the check found nothing, not that the area is proven safe.
import { connectStaging } from "./db";

const { sql } = await connectStaging();
const q = async (s: Promise<Record<string, unknown>[]>) =>
  (await s).map((r) => Object.values(r).join(" | "));

const report = {
  tablesWithoutRls: await q(
    sql`select tablename from pg_tables where schemaname='public' and not rowsecurity order by 1`,
  ),
  tablesForcedRlsOff: (
    await sql`select count(*)::int n from pg_class c join pg_namespace n on n.oid=c.relnamespace where n.nspname='public' and c.relkind='r' and c.relrowsecurity`
  )[0]?.n,
  // Views run with their owner's rights unless security_invoker is set, which would bypass RLS.
  viewsWithoutSecurityInvoker:
    await q(sql`select c.relname from pg_class c join pg_namespace n on n.oid=c.relnamespace
    where n.nspname='public' and c.relkind in ('v','m') and not coalesce((select bool_or(o like 'security_invoker=%true%' or o='security_invoker=on') from unnest(coalesce(c.reloptions,'{}')) o), false)
    and (has_table_privilege('authenticated', c.oid, 'select') or has_table_privilege('anon', c.oid, 'select')) order by 1`),
  anonTablePrivileges: await q(sql`select c.relname, array_to_string(array_remove(array[
      case when has_table_privilege('anon',c.oid,'select') then 'select' end, case when has_table_privilege('anon',c.oid,'insert') then 'insert' end,
      case when has_table_privilege('anon',c.oid,'update') then 'update' end, case when has_table_privilege('anon',c.oid,'delete') then 'delete' end], null), ',')
    from pg_class c join pg_namespace n on n.oid=c.relnamespace where n.nspname='public' and c.relkind='r'
    and has_table_privilege('anon',c.oid,'select,insert,update,delete') order by 1`),
  truncateOrTriggerGrants:
    await q(sql`select c.relname, r from pg_class c join pg_namespace n on n.oid=c.relnamespace, unnest(array['anon','authenticated']) r
    where n.nspname='public' and c.relkind='r' and (has_table_privilege(r,c.oid,'truncate') or has_table_privilege(r,c.oid,'trigger') or has_table_privilege(r,c.oid,'references')) order by 1`),
  // Permissive write policies whose condition is literally true.
  alwaysTrueWritePolicies:
    await q(sql`select tablename, policyname, cmd from pg_policies where schemaname='public' and cmd <> 'SELECT'
    and (coalesce(qual,'') in ('true','(true)') or coalesce(with_check,'') in ('true','(true)')) order by 1`),
  alwaysTrueReadPolicies:
    await q(sql`select tablename, policyname, array_to_string(roles, ',') from pg_policies where schemaname='public' and cmd in ('SELECT','ALL')
    and coalesce(qual,'') in ('true','(true)') order by 1`),
  anonOrPublicPolicies: await q(
    sql`select tablename, policyname, cmd from pg_policies where schemaname='public' and ('anon'=any(roles) or 'public'=any(roles)) order by 1`,
  ),
  definerWithoutSearchPath:
    await q(sql`select p.proname from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and p.prosecdef
    and not exists (select 1 from unnest(coalesce(p.proconfig,'{}')) c where c like 'search_path=%') order by 1`),
  definerMutableSearchPath:
    await q(sql`select p.proname, c from pg_proc p join pg_namespace n on n.oid=p.pronamespace, unnest(coalesce(p.proconfig,'{}')) c
    where n.nspname='public' and p.prosecdef and c like 'search_path=%' and c !~ '^search_path=(""|public|public, *pg_temp|public, *extensions|pg_catalog, *public|public, *pg_catalog|public, *extensions, *pg_temp|public, *vault)$' order by 1`),
  definerAnonExecutable:
    await q(sql`select p.proname from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and p.prosecdef
    and p.prorettype <> 'trigger'::regtype and has_function_privilege('anon', p.oid, 'execute') order by 1`),
  definerDynamicSql:
    await q(sql`select p.proname from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and p.prosecdef
    and p.prosrc ~* '\\mexecute\\s+(format|''|\\w+\\s*\\|\\|)' order by 1`),
  // Callable privileged functions with no visible caller check: reviewed by hand (helpers that only read the caller's own rights are expected).
  definerWithoutCallerCheck:
    await q(sql`select p.proname from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and p.prosecdef
    and p.prorettype <> 'trigger'::regtype and has_function_privilege('authenticated', p.oid, 'execute')
    and p.prosrc !~* '(auth\\.uid\\(\\)|has_org_role|has_workspace_role|has_platform_role|is_org_member|verify_ai_accounting|_proof|is_platform_staff|execution_user_allowed|auth\\.jwt\\(\\))' order by 1`),
  definerCount: (
    await sql`select count(*)::int n from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and p.prosecdef`
  )[0]?.n,
  publicBuckets: await q(sql`select id from storage.buckets where public order by 1`),
  storagePolicies: (
    await sql`select count(*)::int n from pg_policies where schemaname='storage' and tablename='objects'`
  )[0]?.n,
  auditLogWritable:
    await q(sql`select r, p from unnest(array['anon','authenticated']) r, unnest(array['insert','update','delete','truncate']) p
    where has_table_privilege(r, 'public.audit_logs', p)`),
  extensions: await q(sql`select extname, extversion from pg_extension order by 1`),
};
console.log(JSON.stringify(report, null, 1));
await sql.end();
