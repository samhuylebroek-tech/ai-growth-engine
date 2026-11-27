-- Assertions for docs/proposals/0058. Runs in a rolled-back transaction. When an owner already exists
-- (staging after formal initialization), the fixture verifies re-initialization is refused instead.
do $$
declare
  a uuid := gen_random_uuid(); b uuid := gen_random_uuid(); n uuid := gen_random_uuid(); o uuid; r jsonb; rb jsonb; req uuid; c int;
  pre boolean; pass int := 0; fail int := 0; failures text := '';
begin
  -- Exercise the fresh-database path even where an owner exists: inside this rolled-back
  -- transaction only, the guards are lifted to clear the existing owner, then restored.
  pre := exists (select 1 from public.platform_roles where role = 'platform_owner');
  if pre or exists (select 1 from public.platform_owner_initialization) then
    alter table public.platform_roles disable trigger platform_owner_role_guard;
    alter table public.platform_owner_initialization disable trigger platform_owner_initialization_immutable;
    delete from public.platform_roles where role = 'platform_owner';
    delete from public.platform_owner_initialization;
    update public.platform_owner_requests set completed_at = coalesce(completed_at, now());
    alter table public.platform_roles enable trigger platform_owner_role_guard;
    alter table public.platform_owner_initialization enable trigger platform_owner_initialization_immutable;
  end if;
  insert into auth.users(id,email,aud,role,instance_id,email_confirmed_at) values
    (a,'owner-candidate@test.local','authenticated','authenticated','00000000-0000-0000-0000-000000000000',now()),
    (b,'org-owner@test.local','authenticated','authenticated','00000000-0000-0000-0000-000000000000',now()),
    (n,'unconfirmed@test.local','authenticated','authenticated','00000000-0000-0000-0000-000000000000',null);
  -- An organization owner/administrator cannot obtain platform rights.
  perform set_config('request.jwt.claims', json_build_object('sub',b,'role','authenticated')::text, true); execute 'set local role authenticated';
  o := public.create_organization('Owner init fixture','X');
  begin insert into public.platform_roles(user_id,role) values (b,'platform_owner'); fail:=fail+1; failures:=failures||' org_owner_self_insert'; exception when others then if sqlstate in ('P0001','42501','23514','23505','23503') then pass:=pass+1; else fail:=fail+1; failures:=failures||' unexpected:'||sqlstate||':'||left(sqlerrm,60); end if; end;
  begin perform public.complete_platform_owner_initialization(gen_random_uuid(), b, 'org-owner@test.local'); fail:=fail+1; failures:=failures||' session_completes'; exception when others then if sqlstate in ('P0001','42501','23514','23505','23503') then pass:=pass+1; else fail:=fail+1; failures:=failures||' unexpected:'||sqlstate||':'||left(sqlerrm,60); end if; end;
  if not public.has_platform_role('platform_owner') then pass:=pass+1; else fail:=fail+1; failures:=failures||' org_owner_is_platform'; end if;
  begin update public.audit_logs set action='x' where true; get diagnostics c = row_count; if c = 0 then pass:=pass+1; else fail:=fail+1; failures:=failures||' session_updates_audit'; end if; exception when others then if sqlstate in ('P0001','42501','23514','23505','23503') then pass:=pass+1; else fail:=fail+1; failures:=failures||' unexpected:'||sqlstate||':'||left(sqlerrm,60); end if; end;
  execute 'reset role';
  begin
    perform set_config('request.jwt.claims', json_build_object('sub',n,'role','authenticated')::text, true); execute 'set local role authenticated';
    begin perform public.request_platform_owner_initialization(); fail:=fail+1; failures:=failures||' unconfirmed_request'; exception when others then if sqlstate in ('P0001','42501','23514','23505','23503') then pass:=pass+1; else fail:=fail+1; failures:=failures||' unexpected:'||sqlstate||':'||left(sqlerrm,60); end if; end;
    execute 'reset role';
    perform set_config('request.jwt.claims', json_build_object('sub',a,'role','authenticated')::text, true); execute 'set local role authenticated';
    r := public.request_platform_owner_initialization(); req := (r->>'request_id')::uuid;
    if r->>'email' = 'owner-candidate@test.local' and (r->>'user_id')::uuid = a then pass:=pass+1; else fail:=fail+1; failures:=failures||' request_identity'; end if;
    if not public.has_platform_role('platform_owner') then pass:=pass+1; else fail:=fail+1; failures:=failures||' request_grants'; end if;
    if (public.request_platform_owner_initialization()->>'request_id')::uuid = req then pass:=pass+1; else fail:=fail+1; failures:=failures||' request_reused'; end if;
    execute 'reset role';
    perform set_config('request.jwt.claims', '', true);
    begin perform public.complete_platform_owner_initialization(req, b, 'owner-candidate@test.local'); fail:=fail+1; failures:=failures||' wrong_user'; exception when others then if sqlstate in ('P0001','42501','23514','23505','23503') then pass:=pass+1; else fail:=fail+1; failures:=failures||' unexpected:'||sqlstate||':'||left(sqlerrm,60); end if; end;
    begin perform public.complete_platform_owner_initialization(req, a, 'someone@else.test'); fail:=fail+1; failures:=failures||' wrong_email'; exception when others then if sqlstate in ('P0001','42501','23514','23505','23503') then pass:=pass+1; else fail:=fail+1; failures:=failures||' unexpected:'||sqlstate||':'||left(sqlerrm,60); end if; end;
    r := public.complete_platform_owner_initialization(req, a, 'Owner-Candidate@test.local');
    if exists (select 1 from public.platform_roles where user_id=a and role='platform_owner') then pass:=pass+1; else fail:=fail+1; failures:=failures||' assigned'; end if;
    if exists (select 1 from public.audit_logs where id=(r->>'audit_id')::bigint and action='platform_owner.initialized' and target_id=a::text and actor_id is null and metadata->>'request_id'=req::text) then pass:=pass+1; else fail:=fail+1; failures:=failures||' audit'; end if;
    begin perform public.complete_platform_owner_initialization(req, a, 'owner-candidate@test.local'); fail:=fail+1; failures:=failures||' replay'; exception when others then if sqlstate in ('P0001','42501','23514','23505','23503') then pass:=pass+1; else fail:=fail+1; failures:=failures||' unexpected:'||sqlstate||':'||left(sqlerrm,60); end if; end;
    perform set_config('request.jwt.claims', json_build_object('sub',b,'role','authenticated')::text, true); execute 'set local role authenticated';
    begin perform public.request_platform_owner_initialization(); fail:=fail+1; failures:=failures||' second_request'; exception when others then if sqlstate in ('P0001','42501','23514','23505','23503') then pass:=pass+1; else fail:=fail+1; failures:=failures||' unexpected:'||sqlstate||':'||left(sqlerrm,60); end if; end;
    execute 'reset role';
  end;
  -- Even the database owner cannot alter or remove the owner role, the audit trail or the initialization record.
  begin insert into public.platform_roles(user_id,role) values (b,'platform_owner'); fail:=fail+1; failures:=failures||' admin_inserts_owner'; exception when others then if sqlstate in ('P0001','42501','23514','23505','23503') then pass:=pass+1; else fail:=fail+1; failures:=failures||' unexpected:'||sqlstate||':'||left(sqlerrm,60); end if; end;
  begin delete from public.platform_roles where role='platform_owner'; get diagnostics c = row_count; if c=0 and not exists(select 1 from public.platform_roles where role='platform_owner') then pass:=pass+1; else fail:=fail+1; failures:=failures||' admin_deletes_owner'; end if; exception when others then if sqlstate in ('P0001','42501','23514','23505','23503') then pass:=pass+1; else fail:=fail+1; failures:=failures||' unexpected:'||sqlstate||':'||left(sqlerrm,60); end if; end;
  begin update public.audit_logs set metadata='{}' where action like 'platform_owner.%'; fail:=fail+1; failures:=failures||' admin_updates_audit'; exception when others then if sqlstate in ('P0001','42501','23514','23505','23503') then pass:=pass+1; else fail:=fail+1; failures:=failures||' unexpected:'||sqlstate||':'||left(sqlerrm,60); end if; end;
  begin delete from public.audit_logs where action like 'platform_owner.%'; fail:=fail+1; failures:=failures||' admin_deletes_audit'; exception when others then if sqlstate in ('P0001','42501','23514','23505','23503') then pass:=pass+1; else fail:=fail+1; failures:=failures||' unexpected:'||sqlstate||':'||left(sqlerrm,60); end if; end;
  begin delete from public.platform_owner_initialization; get diagnostics c = row_count; if c = 0 and not exists(select 1 from public.platform_owner_initialization) then pass:=pass+1; else fail:=fail+1; failures:=failures||' admin_deletes_init'; end if; exception when others then if sqlstate in ('P0001','42501','23514','23505','23503') then pass:=pass+1; else fail:=fail+1; failures:=failures||' unexpected:'||sqlstate||':'||left(sqlerrm,60); end if; end;
  if not has_function_privilege('authenticated','public.complete_platform_owner_initialization(uuid,uuid,text)','execute')
     and not has_function_privilege('anon','public.request_platform_owner_initialization()','execute')
     and not has_table_privilege('authenticated','public.platform_roles','insert,update,delete')
     and not has_table_privilege('authenticated','public.audit_logs','insert,update,delete')
     and not has_table_privilege('authenticated','public.platform_owner_initialization','select')
  then pass:=pass+1; else fail:=fail+1; failures:=failures||' privileges'; end if;
  raise exception 'OWNER_INIT_RESULT pass=% fail=% failures=[%]', pass, fail, failures;
end $$;
