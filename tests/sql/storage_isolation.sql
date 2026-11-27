-- Private file storage isolation by organization/workspace path. Always raises, so it rolls back.
-- Output: 'STORAGE_RESULT pass=N fail=M ...'.
-- Deletes are blocked for direct SQL by the storage service itself, so delete rules are checked through the Storage API only.
do $$
declare
  ua uuid := gen_random_uuid(); ub uuid := gen_random_uuid(); uv uuid := gen_random_uuid();
  oa uuid; ob uuid; wa uuid; wb uuid; pa text; pe text; n int; pass int := 0; fail int := 0; failures text := '';
begin
  insert into auth.users(id,email,aud,role,instance_id) values
    (ua,'st-a@test.local','authenticated','authenticated','00000000-0000-0000-0000-000000000000'),
    (ub,'st-b@test.local','authenticated','authenticated','00000000-0000-0000-0000-000000000000'),
    (uv,'st-v@test.local','authenticated','authenticated','00000000-0000-0000-0000-000000000000');
  select count(*) into n from storage.buckets where id in ('documents','execution-files') and not public;
  if n=2 then pass:=pass+1; else fail:=fail+1; failures:=failures||' private_buckets'; end if;

  perform set_config('request.jwt.claims', json_build_object('sub',ua,'role','authenticated')::text, true);
  execute 'set local role authenticated';
  oa := public.create_organization('ST A','WS A'); select id into wa from public.workspaces where org_id=oa;
  pa := oa||'/'||wa||'/report.pdf'; pe := oa||'/'||wa||'/'||gen_random_uuid()||'/note.txt';
  insert into storage.objects(bucket_id,name,owner_id) values('documents',pa,ua::text); pass:=pass+1;
  insert into storage.objects(bucket_id,name,owner_id) values('execution-files',pe,ua::text); pass:=pass+1;
  begin insert into storage.objects(bucket_id,name,owner_id) values('documents','not-a-scope/x.pdf',ua::text); fail:=fail+1; failures:=failures||' unscoped_path'; exception when others then if sqlstate in ('P0001','42501','23514','23505','23503','22P02') then pass:=pass+1; else fail:=fail+1; failures:=failures||' unexpected:'||sqlstate||':'||left(sqlerrm,60); end if; end;  -- a path that is not a scope id is refused by the uuid cast in the policy
  execute 'reset role';
  insert into public.organization_members(org_id,user_id,role) values(oa,uv,'viewer');
  insert into public.workspace_members(workspace_id,user_id,role) values(wa,uv,'viewer');

  perform set_config('request.jwt.claims', json_build_object('sub',ub,'role','authenticated')::text, true);
  execute 'set local role authenticated';
  ob := public.create_organization('ST B','WS B'); select id into wb from public.workspaces where org_id=ob;
  select count(*) into n from storage.objects where name in (pa,pe); if n=0 then pass:=pass+1; else fail:=fail+1; failures:=failures||' outsider_reads'; end if;
  begin insert into storage.objects(bucket_id,name,owner_id) values('documents',oa||'/'||wa||'/evil.pdf',ub::text); fail:=fail+1; failures:=failures||' outsider_upload_docs'; exception when others then if sqlstate in ('P0001','42501','23514','23505','23503') then pass:=pass+1; else fail:=fail+1; failures:=failures||' unexpected:'||sqlstate||':'||left(sqlerrm,60); end if; end;
  begin insert into storage.objects(bucket_id,name,owner_id) values('execution-files',oa||'/'||wa||'/x/evil.txt',ub::text); fail:=fail+1; failures:=failures||' outsider_upload_exec'; exception when others then if sqlstate in ('P0001','42501','23514','23505','23503') then pass:=pass+1; else fail:=fail+1; failures:=failures||' unexpected:'||sqlstate||':'||left(sqlerrm,60); end if; end;
  begin insert into storage.objects(bucket_id,name,owner_id) values('documents',ob||'/'||wa||'/mixed.pdf',ub::text); fail:=fail+1; failures:=failures||' mixed_scope_path'; exception when others then if sqlstate in ('P0001','42501','23514','23505','23503') then pass:=pass+1; else fail:=fail+1; failures:=failures||' unexpected:'||sqlstate||':'||left(sqlerrm,60); end if; end;
  execute 'reset role';

  perform set_config('request.jwt.claims', json_build_object('sub',uv,'role','authenticated')::text, true);
  execute 'set local role authenticated';
  select count(*) into n from storage.objects where name in (pa,pe); if n=2 then pass:=pass+1; else fail:=fail+1; failures:=failures||' viewer_reads'; end if;
  begin insert into storage.objects(bucket_id,name,owner_id) values('documents',oa||'/'||wa||'/viewer.pdf',uv::text); fail:=fail+1; failures:=failures||' viewer_uploads'; exception when others then if sqlstate in ('P0001','42501','23514','23505','23503') then pass:=pass+1; else fail:=fail+1; failures:=failures||' unexpected:'||sqlstate||':'||left(sqlerrm,60); end if; end;
  execute 'reset role';

  perform set_config('request.jwt.claims', '{"role":"anon"}', true);
  execute 'set local role anon';
  select count(*) into n from storage.objects; if n=0 then pass:=pass+1; else fail:=fail+1; failures:=failures||' anon_reads'; end if;
  execute 'reset role';
  raise exception 'STORAGE_RESULT pass=% fail=% failures=[%]', pass, fail, failures;
end $$;
