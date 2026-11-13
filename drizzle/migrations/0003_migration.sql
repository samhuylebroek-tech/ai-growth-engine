
do $$ declare t text; begin
  for t in select tablename from pg_tables where schemaname='public' and tablename not in ('plans','plan_entitlements') loop
    execute format('revoke all on public.%I from anon', t);
  end loop;
end $$;
