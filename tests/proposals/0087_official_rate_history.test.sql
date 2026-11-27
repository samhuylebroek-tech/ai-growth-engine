-- Assertions for docs/proposals/0087 (rolled back): the official-rate import accepts the ECB 90-day history (up to 100
-- days back), still refuses future and older dates, forged proofs and outsiders, stays idempotent per day and audits.
do $$
declare
  uo uuid := gen_random_uuid(); ux uuid := gen_random_uuid();
  o uuid; n int; pass int := 0; fail int := 0; failures text := '';
  rates jsonb := '[{"currency":"USD","rate":"1.0990"},{"currency":"GBP","rate":"0.83735"}]';
begin
  execute $t$CREATE OR REPLACE FUNCTION public.verify_ai_accounting(_proof text) RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $b$ BEGIN IF _proof IS DISTINCT FROM 'rollback-fixture-only' THEN RAISE EXCEPTION 'server accounting verification required'; END IF; END $b$ $t$;
  insert into auth.users(id,email,aud,role,instance_id) values
    (uo,'fxh-owner@test.local','authenticated','authenticated','00000000-0000-0000-0000-000000000000'),
    (ux,'fxh-outsider@test.local','authenticated','authenticated','00000000-0000-0000-0000-000000000000');
  perform set_config('request.jwt.claims', json_build_object('sub',uo,'role','authenticated')::text, true); execute 'set local role authenticated';
  o := public.create_organization('FXH fixture','Main');
  -- 1-2. dates inside the ECB history window are accepted
  n := public.import_official_rates_verified(o,current_date-30,rates,'rollback-fixture-only');
  if n=2 then pass:=pass+1; else fail:=fail+1; failures:=failures||' d30:'||n; end if;
  n := public.import_official_rates_verified(o,current_date-89,rates,'rollback-fixture-only');
  if n=2 then pass:=pass+1; else fail:=fail+1; failures:=failures||' d89:'||n; end if;
  -- 3. the same day again adds nothing
  n := public.import_official_rates_verified(o,current_date-30,rates,'rollback-fixture-only');
  if n=0 then pass:=pass+1; else fail:=fail+1; failures:=failures||' idempotent:'||n; end if;
  -- 4-6. older than the window, future, forged proof
  begin perform public.import_official_rates_verified(o,current_date-101,rates,'rollback-fixture-only'); fail:=fail+1; failures:=failures||' too_old'; exception when others then if sqlstate='P0001' then pass:=pass+1; else fail:=fail+1; failures:=failures||' u1:'||sqlstate; end if; end;
  begin perform public.import_official_rates_verified(o,current_date+1,rates,'rollback-fixture-only'); fail:=fail+1; failures:=failures||' future'; exception when others then if sqlstate='P0001' then pass:=pass+1; else fail:=fail+1; failures:=failures||' u2:'||sqlstate; end if; end;
  begin perform public.import_official_rates_verified(o,current_date-10,rates,'forged'); fail:=fail+1; failures:=failures||' forged'; exception when others then if sqlstate in ('P0001','42501') then pass:=pass+1; else fail:=fail+1; failures:=failures||' u3:'||sqlstate; end if; end;
  -- 7. an outsider cannot import into the organization
  execute 'reset role'; perform set_config('request.jwt.claims', json_build_object('sub',ux,'role','authenticated')::text, true); execute 'set local role authenticated';
  begin perform public.import_official_rates_verified(o,current_date-20,rates,'rollback-fixture-only'); fail:=fail+1; failures:=failures||' outsider'; exception when others then if sqlstate in ('P0001','42501') then pass:=pass+1; else fail:=fail+1; failures:=failures||' u4:'||sqlstate; end if; end;
  execute 'reset role';
  -- 8. rows are official, dated and sourced; 9. each adding import is audited
  select count(*) into n from public.exchange_rates where org_id=o and kind='official' and source ilike 'ECB%' and rate_date in (current_date-30, current_date-89);
  if n=4 then pass:=pass+1; else fail:=fail+1; failures:=failures||' stored:'||n; end if;
  select count(*) into n from public.audit_logs where org_id=o and action='finance.official_rates_imported';
  if n=2 then pass:=pass+1; else fail:=fail+1; failures:=failures||' audit:'||n; end if;
  -- 10. official rows stay permanent
  begin update public.exchange_rates set rate=2 where org_id=o and quote_currency='USD'; fail:=fail+1; failures:=failures||' permanent'; exception when others then if sqlstate in ('P0001','42501','23514') then pass:=pass+1; else fail:=fail+1; failures:=failures||' u5:'||sqlstate; end if; end;
  raise exception 'RATE_HISTORY_RESULT pass=% fail=% failures=[%]', pass, fail, failures;
end $$;
