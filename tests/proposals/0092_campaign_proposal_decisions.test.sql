-- Assertions for docs/proposals/0092 (rolled back): only business admins decide campaign proposals, through any path.
do $$
declare
  uo uuid := gen_random_uuid(); ua uuid := gen_random_uuid(); um uuid := gen_random_uuid(); ue uuid := gen_random_uuid(); ux uuid := gen_random_uuid();
  o uuid; w uuid; c uuid; nid uuid; n int; st text;
  pass int := 0; fail int := 0; failures text := '';
begin
  execute $t$CREATE FUNCTION pg_temp.su(_u uuid) RETURNS void LANGUAGE plpgsql AS $b$ BEGIN RESET ROLE; PERFORM set_config('request.jwt.claims', json_build_object('sub',_u,'role','authenticated')::text, true); SET LOCAL ROLE authenticated; END $b$ $t$;
  execute $t$CREATE FUNCTION pg_temp.root() RETURNS void LANGUAGE plpgsql AS $b$ BEGIN RESET ROLE; END $b$ $t$;
  execute $t$CREATE FUNCTION pg_temp.b(_s text, _t text, _by uuid) RETURNS text LANGUAGE sql AS $b$ SELECT json_build_object('v',1,'status',_s,'text',_t,'decidedBy',_by,'decidedAt',CASE WHEN _by IS NULL THEN NULL ELSE now() END,'note','')::text $b$ $t$;
  execute $t$CREATE FUNCTION pg_temp.try(_id uuid, _body text) RETURNS text LANGUAGE plpgsql AS $b$ DECLARE k int; BEGIN UPDATE public.execution_notes SET body=_body WHERE id=_id; GET DIAGNOSTICS k = ROW_COUNT; RETURN CASE WHEN k=1 THEN 'ok' ELSE 'none' END; EXCEPTION WHEN others THEN RETURN SQLERRM; END $b$ $t$;
  insert into auth.users(id,email,aud,role,instance_id) values
    (uo,'cp-owner@test.local','authenticated','authenticated','00000000-0000-0000-0000-000000000000'),
    (ua,'cp-admin@test.local','authenticated','authenticated','00000000-0000-0000-0000-000000000000'),
    (um,'cp-member@test.local','authenticated','authenticated','00000000-0000-0000-0000-000000000000'),
    (ue,'cp-editor@test.local','authenticated','authenticated','00000000-0000-0000-0000-000000000000'),
    (ux,'cp-outsider@test.local','authenticated','authenticated','00000000-0000-0000-0000-000000000000');
  perform pg_temp.su(uo); o := public.create_organization('CP fixture','Bakery'); select id into w from public.workspaces where org_id=o;
  perform pg_temp.su(ux); perform public.create_organization('CP other','Shop');
  perform pg_temp.root();
  insert into public.organization_members(org_id,user_id,role) values(o,ua,'admin'),(o,um,'member'),(o,ue,'editor');
  insert into public.workspace_members(workspace_id,user_id,role) values(w,ua,'admin'),(w,um,'member'),(w,ue,'editor');
  perform pg_temp.su(um);
  insert into public.campaigns(org_id,workspace_id,title,created_by) values(o,w,'Spring',um) returning id into c;

  -- 1 a member cannot create an already-approved proposal
  begin
    insert into public.execution_notes(org_id,workspace_id,entity_type,entity_id,kind,content_type,title,body,created_by)
      values(o,w,'campaigns',c,'proposal','draft','campaign-proposal',pg_temp.b('approved','Plan',um),um);
    fail:=fail+1; failures:=failures||' insert_approved';
  exception when others then pass:=pass+1; end;
  -- 2 a member creates a draft
  insert into public.execution_notes(org_id,workspace_id,entity_type,entity_id,kind,content_type,title,body,created_by)
    values(o,w,'campaigns',c,'proposal','draft','campaign-proposal',pg_temp.b('draft','Plan',null),um) returning id into nid;
  pass:=pass+1;
  -- 3 member and editor cannot approve or reject directly
  st := pg_temp.try(nid, pg_temp.b('approved','Plan',um));
  if st like '%proposal_decision_denied%' then pass:=pass+1; else fail:=fail+1; failures:=failures||' member_approve:'||st; end if;
  perform pg_temp.su(ue);
  st := pg_temp.try(nid, pg_temp.b('rejected','Plan',ue));
  if st like '%proposal_decision_denied%' then pass:=pass+1; else fail:=fail+1; failures:=failures||' editor_reject:'||st; end if;
  -- 4 an outsider cannot touch it
  perform pg_temp.su(ux);
  st := pg_temp.try(nid, pg_temp.b('draft','Hijack',null));
  if st = 'none' then pass:=pass+1; else fail:=fail+1; failures:=failures||' outsider:'||st; end if;
  -- 5 admin cannot decide in someone else's name or while changing the text
  perform pg_temp.su(ua);
  st := pg_temp.try(nid, pg_temp.b('approved','Plan',um));
  if st like '%proposal_decider_mismatch%' then pass:=pass+1; else fail:=fail+1; failures:=failures||' mismatch:'||st; end if;
  st := pg_temp.try(nid, pg_temp.b('approved','Other plan',ua));
  if st like '%proposal_text_changed%' then pass:=pass+1; else fail:=fail+1; failures:=failures||' textchange:'||st; end if;
  -- 6 admin approves; the decision is audited
  st := pg_temp.try(nid, pg_temp.b('approved','Plan',ua));
  if st = 'ok' then pass:=pass+1; else fail:=fail+1; failures:=failures||' admin_approve:'||st; end if;
  perform pg_temp.root();
  select count(*) into n from public.audit_logs where org_id=o and action='campaign_proposal.approved' and target_id=c::text;
  if n=1 then pass:=pass+1; else fail:=fail+1; failures:=failures||' audit:'||n; end if;
  -- 7 a decision cannot be re-decided
  perform pg_temp.su(ua);
  st := pg_temp.try(nid, pg_temp.b('rejected','Plan',ua));
  if st like '%proposal_already_decided%' then pass:=pass+1; else fail:=fail+1; failures:=failures||' redecide:'||st; end if;
  -- 8 a member may modify, which returns it to draft
  perform pg_temp.su(um);
  st := pg_temp.try(nid, pg_temp.b('draft','Plan v2',null));
  if st = 'ok' then pass:=pass+1; else fail:=fail+1; failures:=failures||' modify:'||st; end if;
  -- 9 the proposal cannot be turned into another note type
  begin
    update public.execution_notes set kind='comment' where id=nid;
    fail:=fail+1; failures:=failures||' retype';
  exception when others then pass:=pass+1; end;
  -- 10 one proposal per campaign
  begin
    insert into public.execution_notes(org_id,workspace_id,entity_type,entity_id,kind,content_type,title,body,created_by)
      values(o,w,'campaigns',c,'proposal','draft','campaign-proposal',pg_temp.b('draft','Second',null),um);
    fail:=fail+1; failures:=failures||' duplicate';
  exception when others then pass:=pass+1; end;
  perform pg_temp.root();
  raise exception 'CAMPAIGN_PROPOSAL_RESULT pass=% fail=% failures=[%]', pass, fail, failures;
end $$;
