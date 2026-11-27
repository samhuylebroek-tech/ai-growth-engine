-- Assertions for docs/proposals/0071 (rolled back): organization-wide totals reconcile with the ledger, each run is
-- counted once, Organization Growth Officer usage is booked apart from its anchor business, per-business detail is
-- limited to businesses the caller can open, and outsiders/anonymous callers get nothing.
do $$
declare
  uo uuid := gen_random_uuid(); um uuid := gen_random_uuid(); ux uuid := gen_random_uuid();
  o uuid; o2 uuid; w1 uuid; w2 uuid; r1 uuid := gen_random_uuid(); r2 uuid := gen_random_uuid(); r3 uuid := gen_random_uuid(); r4 uuid := gen_random_uuid(); r5 uuid := gen_random_uuid();
  j jsonb; bal int; mon date := date_trunc('month', now())::date;
  pass int := 0; fail int := 0; failures text := '';
begin
  execute $t$CREATE FUNCTION pg_temp.su(_u uuid) RETURNS void LANGUAGE plpgsql AS $b$ BEGIN RESET ROLE; PERFORM set_config('request.jwt.claims', json_build_object('sub',_u,'role','authenticated')::text, true); SET LOCAL ROLE authenticated; END $b$ $t$;
  execute $t$CREATE FUNCTION pg_temp.root() RETURNS void LANGUAGE plpgsql AS $b$ BEGIN RESET ROLE; END $b$ $t$;
  insert into auth.users(id,email,aud,role,instance_id) values
    (uo,'co-owner@test.local','authenticated','authenticated','00000000-0000-0000-0000-000000000000'),
    (um,'co-member@test.local','authenticated','authenticated','00000000-0000-0000-0000-000000000000'),
    (ux,'co-outsider@test.local','authenticated','authenticated','00000000-0000-0000-0000-000000000000');
  perform pg_temp.su(uo);
  o := public.create_organization('Credit fixture','Bakery'); select id into w1 from public.workspaces where org_id=o;
  perform pg_temp.root(); update public.subscriptions set plan_key='business' where org_id=o;
  perform pg_temp.su(uo); w2 := public.create_workspace(o,'Catering');
  perform pg_temp.su(ux); o2 := public.create_organization('Other org','Solo');
  perform pg_temp.root();
  insert into public.organization_members(org_id,user_id,role) values(o,um,'member');
  insert into public.workspace_members(workspace_id,user_id,role) values(w1,um,'member');
  -- runs: settled exact (w1 seo), settled with release (w1 seo), refunded (w2), pending (w2), org officer anchored to w1
  insert into public.agent_runs(id,org_id,workspace_id,agent_key,user_id,status,depth) values
    (r1,o,w1,'seo',uo,'succeeded',0),(r2,o,w1,'seo',uo,'succeeded',0),(r3,o,w2,'content',uo,'failed',0),(r4,o,w2,'content',uo,'running',0),(r5,o,w1,'organization_growth_officer',uo,'succeeded',0);
  insert into public.ai_credit_reservations(run_id,org_id,user_id,reserved,charged,status,settled_at) values
    (r1,o,uo,5,5,'settled',now()),(r2,o,uo,6,4,'settled',now()),(r3,o,uo,3,null,'refunded',now()),(r4,o,uo,4,null,'reserved',null),(r5,o,uo,12,10,'settled',now());
  insert into public.credit_ledger(org_id,delta,reason,ref) values
    (o,-5,'usage','run:'||r1||':reserve'),(o,-6,'usage','run:'||r2||':reserve'),(o,2,'refund','run:'||r2||':settle'),
    (o,-3,'usage','run:'||r3||':reserve'),(o,3,'refund','run:'||r3||':failed'),(o,-4,'usage','run:'||r4||':reserve'),
    (o,-12,'usage','run:'||r5||':reserve'),(o,2,'refund','run:'||r5||':settle'),(o,-1,'usage','legacy-call');

  perform pg_temp.su(uo);
  j := public.org_credit_overview(o, mon); bal := public.credit_balance(o);
  if (j->>'balance')::int = bal then pass:=pass+1; else fail:=fail+1; failures:=failures||' balance'; end if;
  if (j->>'consumed')::int = 5+4+10+1 then pass:=pass+1; else fail:=fail+1; failures:=failures||' consumed:'||(j->>'consumed'); end if;
  if (j->>'consumed_month')::int = 20 then pass:=pass+1; else fail:=fail+1; failures:=failures||' consumed_month'; end if;
  if (j->>'reserved_pending')::int = 4 then pass:=pass+1; else fail:=fail+1; failures:=failures||' pending'; end if;
  if (j->>'released')::int = 2+3+2 then pass:=pass+1; else fail:=fail+1; failures:=failures||' released'; end if;
  if (j->>'reconciles')::boolean then pass:=pass+1; else fail:=fail+1; failures:=failures||' reconciles'; end if;
  -- purchased credits and manual adjustments (both directions) are part of the arithmetic, not a mismatch
  perform pg_temp.root();
  insert into public.credit_ledger(org_id,delta,reason,ref) values(o,25,'purchase','credit pack'),(o,10,'adjustment','support credit'),(o,-7,'adjustment','correction');
  perform pg_temp.su(uo); j := public.org_credit_overview(o, mon);
  if (j->>'reconciles')::boolean and (j->>'other_debits')::int = 7 and (j->>'balance')::int = public.credit_balance(o) then pass:=pass+1; else fail:=fail+1; failures:=failures||' adjustments'; end if;
  -- a refund that belongs to no run cannot be explained, so the check reports it instead of hiding it
  perform pg_temp.root(); insert into public.credit_ledger(org_id,delta,reason,ref) values(o,3,'refund','unexplained');
  perform pg_temp.su(uo); j := public.org_credit_overview(o, mon);
  if not (j->>'reconciles')::boolean then pass:=pass+1; else fail:=fail+1; failures:=failures||' mismatch_hidden'; end if;
  perform pg_temp.root(); delete from public.credit_ledger where org_id=o and ref='unexplained'; perform pg_temp.su(uo); j := public.org_credit_overview(o, mon);
  if (j->'org_officer'->>'consumed')::int = 10 then pass:=pass+1; else fail:=fail+1; failures:=failures||' officer'; end if;
  -- the officer run is not booked under its anchor business; w1 shows only the two seo runs
  if (select (b->>'consumed')::int from jsonb_array_elements(j->'businesses') b where b->>'workspace_id' = w1::text) = 9 then pass:=pass+1; else fail:=fail+1; failures:=failures||' anchor_excluded'; end if;
  if (select (b->>'reserved_pending')::int from jsonb_array_elements(j->'businesses') b where b->>'workspace_id' = w2::text) = 4 then pass:=pass+1; else fail:=fail+1; failures:=failures||' w2_pending'; end if;
  -- each run counted once: business totals + officer + hidden equal the run-linked total
  if (select sum((b->>'consumed')::int) from jsonb_array_elements(j->'businesses') b) + (j->'org_officer'->>'consumed')::int + (j->'not_visible'->>'consumed')::int + (j->>'direct_used')::int = (j->>'consumed')::int then pass:=pass+1; else fail:=fail+1; failures:=failures||' once'; end if;
  if (select sum((s->>'consumed')::int) from jsonb_array_elements(j->'specialists') s) = (select sum((b->>'consumed')::int) from jsonb_array_elements(j->'businesses') b) then pass:=pass+1; else fail:=fail+1; failures:=failures||' specialists_sum'; end if;

  -- member with only w1: org totals, w1 detail, w2 only as an amount without business identity
  perform pg_temp.su(um);
  j := public.org_credit_overview(o, mon);
  if jsonb_array_length(j->'businesses') = 1 and j->'businesses'->0->>'workspace_id' = w1::text then pass:=pass+1; else fail:=fail+1; failures:=failures||' member_scope'; end if;
  if not exists (select 1 from jsonb_array_elements(j->'specialists') s where s->>'workspace_id' = w2::text) then pass:=pass+1; else fail:=fail+1; failures:=failures||' member_specialists'; end if;
  if (j->'not_visible'->>'reserved_pending')::int = 4 and position(w2::text in j::text) = 0 then pass:=pass+1; else fail:=fail+1; failures:=failures||' not_visible'; end if;
  if (j->>'consumed')::int = 20 then pass:=pass+1; else fail:=fail+1; failures:=failures||' member_total'; end if;

  -- outsider and anonymous
  perform pg_temp.su(ux);
  begin perform public.org_credit_overview(o, mon); fail:=fail+1; failures:=failures||' outsider'; exception when others then if sqlstate in ('P0001','42501') then pass:=pass+1; else fail:=fail+1; failures:=failures||' unexpected:'||sqlstate; end if; end;
  perform pg_temp.root();
  if not has_function_privilege('anon','public.org_credit_overview(uuid,date)','execute') then pass:=pass+1; else fail:=fail+1; failures:=failures||' anon'; end if;
  -- months: a different month shows no usage this month
  perform pg_temp.su(uo);
  j := public.org_credit_overview(o, (mon - interval '2 months')::date);
  if (j->>'consumed_month')::int = 0 and (j->>'consumed')::int = 20 then pass:=pass+1; else fail:=fail+1; failures:=failures||' other_month'; end if;
  raise exception 'CREDIT_OVERVIEW_RESULT pass=% fail=% failures=[%]', pass, fail, failures;
end $$;
