-- Privilege guard: signed-out callers and app users hold only the privileges the app needs.
-- Read-only; raises the result so nothing persists. Output: 'PRIVILEGE_RESULT pass=N fail=M ...'.
do $$
declare n int; names text; pass int := 0; fail int := 0; failures text := '';
begin
  select count(*), string_agg(c.relname, ',') into n, names from pg_class c join pg_namespace s on s.oid=c.relnamespace
   where s.nspname='public' and c.relkind='r' and c.relname not in ('plans','plan_entitlements')
     and has_table_privilege('anon', c.oid, 'select,insert,update,delete');
  if n=0 then pass:=pass+1; else fail:=fail+1; failures:=failures||' anon_tables('||names||')'; end if;
  select count(*), string_agg(c.relname, ',') into n, names from pg_class c join pg_namespace s on s.oid=c.relnamespace
   where s.nspname='public' and c.relkind='r' and c.relname in ('plans','plan_entitlements')
     and has_table_privilege('anon', c.oid, 'insert,update,delete');
  if n=0 then pass:=pass+1; else fail:=fail+1; failures:=failures||' anon_writes_catalogue'; end if;
  select count(*), string_agg(c.relname, ',') into n, names from pg_class c join pg_namespace s on s.oid=c.relnamespace
   where s.nspname='public' and c.relkind='r'
     and (has_table_privilege('anon', c.oid, 'truncate') or has_table_privilege('authenticated', c.oid, 'truncate'));
  if n=0 then pass:=pass+1; else fail:=fail+1; failures:=failures||' truncate('||names||')'; end if;
  select count(*), string_agg(p.proname, ',') into n, names from pg_proc p join pg_namespace s on s.oid=p.pronamespace
   where s.nspname='public' and p.prosecdef and p.prorettype <> 'trigger'::regtype and p.proname <> 'is_platform_staff'
     and has_function_privilege('anon', p.oid, 'execute');
  if n=0 then pass:=pass+1; else fail:=fail+1; failures:=failures||' anon_functions('||names||')'; end if;
  select count(*), string_agg(c.relname, ',') into n, names from pg_class c join pg_namespace s on s.oid=c.relnamespace
   where s.nspname='public' and c.relname in ('growth_plan_versions','growth_initiatives','growth_initiative_operations')
     and has_table_privilege('authenticated', c.oid, 'insert,update,delete');
  if n=0 then pass:=pass+1; else fail:=fail+1; failures:=failures||' growth_plan_direct_writes('||names||')'; end if;
  select count(*) into n from pg_class c join pg_namespace s on s.oid=c.relnamespace where s.nspname='public' and c.relkind='r' and not c.relrowsecurity;
  if n=0 then pass:=pass+1; else fail:=fail+1; failures:=failures||' rls_disabled'; end if;
  -- Helpers used by RLS policies stay callable; execution_user_allowed is internal-only once proposal 0088 is applied.
  if has_function_privilege('authenticated','public.has_workspace_role(uuid,public.org_role)','execute')
     and (has_function_privilege('authenticated','public.execution_user_allowed(uuid,uuid)','execute') = (to_regclass('public.audit_chain_head') is null))
     and has_function_privilege('anon','public.is_platform_staff()','execute')
  then pass:=pass+1; else fail:=fail+1; failures:=failures||' helpers_callable'; end if;
  raise exception 'PRIVILEGE_RESULT pass=% fail=% failures=[%]', pass, fail, failures;
end $$;
