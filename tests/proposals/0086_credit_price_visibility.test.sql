-- Assertions for docs/proposals/0086 (rolled back): only the Platform Owner reads the credit price history; members
-- see the applying prices (platform + own plan, no reasons or authors) through credit_prices_in_effect(); other
-- plans' prices stay hidden; writing remains Platform Owner only, never back-dated, insert-only; later prices never
-- change earlier ones.
do $$
declare
  uo uuid := gen_random_uuid(); uv uuid := gen_random_uuid(); ux uuid := gen_random_uuid(); up uuid;
  o uuid; o2 uuid; w uuid; myplan text; other text; n int; p numeric;
  pass int := 0; fail int := 0; failures text := '';
begin
  execute $t$CREATE FUNCTION pg_temp.su(_u uuid) RETURNS void LANGUAGE plpgsql AS $b$ BEGIN RESET ROLE; PERFORM set_config('request.jwt.claims', json_build_object('sub',_u,'role','authenticated','aal','aal2')::text, true); SET LOCAL ROLE authenticated; END $b$ $t$;
  execute $t$CREATE FUNCTION pg_temp.root() RETURNS void LANGUAGE plpgsql AS $b$ BEGIN RESET ROLE; END $b$ $t$;
  insert into auth.users(id,email,aud,role,instance_id) values
    (uo,'ucp-owner@test.local','authenticated','authenticated','00000000-0000-0000-0000-000000000000'),
    (uv,'ucp-viewer@test.local','authenticated','authenticated','00000000-0000-0000-0000-000000000000'),
    (ux,'ucp-outsider@test.local','authenticated','authenticated','00000000-0000-0000-0000-000000000000');
  perform pg_temp.su(uo); o := public.create_organization('UCP fixture','Bakery'); select id into w from public.workspaces where org_id=o;
  perform pg_temp.root();
  insert into public.organization_members(org_id,user_id,role) values(o,uv,'viewer');
  select user_id into up from public.platform_roles where role = 'platform_owner' limit 1;
  if up is null then raise exception 'no Platform Owner in this environment'; end if;
  select plan_key into myplan from public.subscriptions where org_id=o;
  select key into other from public.plans where key <> myplan order by tier limit 1;

  -- 1. prices: platform now and later, the org's own plan, another plan
  perform pg_temp.su(up);
  perform public.set_credit_price('platform', null, 'EUR', 0.05, now() + interval '1 minute', 'UCP platform v1');
  perform public.set_credit_price('platform', null, 'EUR', 0.07, now() + interval '30 days', 'UCP platform v2');
  perform public.set_credit_price('platform', null, 'USD', 0.06, now() + interval '1 minute', 'UCP platform usd');
  perform public.set_credit_price('plan', myplan, 'EUR', 0.04, now() + interval '1 minute', 'UCP own plan');
  if other is not null then perform public.set_credit_price('plan', other, 'EUR', 0.03, now() + interval '1 minute', 'UCP other plan'); end if;
  select count(*) into n from public.credit_price_versions where methodology like 'UCP %';
  if n = 5 - (other is null)::int then pass:=pass+1; else fail:=fail+1; failures:=failures||' owner_history:'||n; end if;

  -- 2. an organization owner and a viewer cannot read the history table
  perform pg_temp.su(uo);
  select count(*) into n from public.credit_price_versions where methodology like 'UCP %';
  if n=0 then pass:=pass+1; else fail:=fail+1; failures:=failures||' owner_reads_history:'||n; end if;
  perform pg_temp.su(uv);
  select count(*) into n from public.credit_price_versions;
  if n=0 then pass:=pass+1; else fail:=fail+1; failures:=failures||' viewer_reads_history:'||n; end if;

  -- 3. the viewer sees the applying prices: platform (both versions, both currencies) and the own plan, not other plans
  select count(*) into n from public.credit_prices_in_effect() c where c.price_per_credit in (0.05, 0.07, 0.06, 0.04, 0.03) and c.effective_from > now();
  if n=4 then pass:=pass+1; else fail:=fail+1; failures:=failures||' viewer_in_effect:'||n; end if;
  select count(*) into n from public.credit_prices_in_effect() c where c.plan_key is not null and c.plan_key <> myplan;
  if n=0 then pass:=pass+1; else fail:=fail+1; failures:=failures||' other_plan_visible:'||n; end if;

  -- 4. an outsider sees platform prices but not this organization's plan price unless on the same plan
  perform pg_temp.su(ux); o2 := public.create_organization('UCP other','Shop');
  select count(*) into n from public.credit_prices_in_effect() c where c.scope='platform' and c.price_per_credit in (0.05, 0.07, 0.06) and c.effective_from > now(); -- fixture rows only (they start in the future); a real staging price does not count
  if n=3 then pass:=pass+1; else fail:=fail+1; failures:=failures||' outsider_platform:'||n; end if;

  -- 5. writing stays Platform Owner only, validated and never back-dated
  perform pg_temp.su(uo);
  begin perform public.set_credit_price('platform', null, 'EUR', 0.01, now() + interval '1 day', 'UCP org owner'); fail:=fail+1; failures:=failures||' org_owner_sets';
    exception when others then if sqlstate='42501' then pass:=pass+1; else fail:=fail+1; failures:=failures||' org_owner_sets:'||sqlstate; end if; end;
  begin insert into public.credit_price_versions(scope,currency,price_per_credit,effective_from,methodology,created_by) values('platform','EUR',0.01,now()+interval '1 day','UCP direct',uo);
    fail:=fail+1; failures:=failures||' direct_insert'; exception when others then pass:=pass+1; end;
  perform pg_temp.su(up);
  begin perform public.set_credit_price('platform', null, 'EUR', 0, now() + interval '1 day', 'UCP zero'); fail:=fail+1; failures:=failures||' zero_price';
    exception when others then if sqlstate='22023' then pass:=pass+1; else fail:=fail+1; failures:=failures||' zero_price:'||sqlstate; end if; end;
  begin perform public.set_credit_price('platform', null, 'EURO', 0.02, now() + interval '1 day', 'UCP bad currency'); fail:=fail+1; failures:=failures||' bad_currency';
    exception when others then if sqlstate='22023' then pass:=pass+1; else fail:=fail+1; failures:=failures||' bad_currency:'||sqlstate; end if; end;
  begin perform public.set_credit_price('platform', null, 'EUR', 0.02, now() - interval '2 days', 'UCP backdated'); fail:=fail+1; failures:=failures||' backdated';
    exception when others then if sqlstate='P0001' then pass:=pass+1; else fail:=fail+1; failures:=failures||' backdated:'||sqlstate; end if; end;
  -- the same start for the same scope/currency is refused (two simultaneous changes cannot both win)
  begin insert into public.credit_price_versions(scope,currency,price_per_credit,effective_from,methodology,created_by)
    select scope,currency,0.09,effective_from,'UCP duplicate start',up from public.credit_price_versions where methodology='UCP platform v1';
    fail:=fail+1; failures:=failures||' duplicate_start'; exception when others then pass:=pass+1; end;

  -- 6. a later price leaves the earlier version untouched
  select price_per_credit into p from public.credit_price_versions where methodology='UCP platform v1';
  if p=0.05 then pass:=pass+1; else fail:=fail+1; failures:=failures||' v1_changed:'||p; end if;
  perform pg_temp.root();
  begin update public.credit_price_versions set price_per_credit=1 where methodology='UCP platform v1'; fail:=fail+1; failures:=failures||' mutable';
    exception when others then pass:=pass+1; end;
  begin delete from public.credit_price_versions where methodology='UCP platform v1'; fail:=fail+1; failures:=failures||' deletable';
    exception when others then pass:=pass+1; end;
  -- 7. anonymous callers cannot use the function
  begin set local role anon; perform public.credit_prices_in_effect(); reset role; fail:=fail+1; failures:=failures||' anon_call';
    exception when others then reset role; pass:=pass+1; end;
  RESET ROLE;
  raise exception 'CREDIT_PRICE_VISIBILITY_RESULT pass=% fail=% failures=[%]', pass, fail, failures;
end $$;
