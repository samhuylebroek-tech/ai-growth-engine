-- Assertions for docs/proposals/0069 (rolled back): official rates need server proof, are stored once, are permanent,
-- are readable only inside the organization and coexist with manual rates. (The too-old date is 120 days so it
-- stays refused after proposal 0087 widened the accepted window from 14 to 100 days.)
do $$
declare
  uo uuid := gen_random_uuid(); um uuid := gen_random_uuid(); ux uuid := gen_random_uuid();
  o uuid; o2 uuid; n int; k text; pass int := 0; fail int := 0; failures text := '';
  rates jsonb := '[{"currency":"USD","rate":"1.0990"},{"currency":"GBP","rate":"0.83735"}]';
begin
  execute $t$CREATE OR REPLACE FUNCTION public.verify_ai_accounting(_proof text) RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $b$ BEGIN IF _proof IS DISTINCT FROM 'rollback-fixture-only' THEN RAISE EXCEPTION 'server accounting verification required'; END IF; END $b$ $t$;
  insert into auth.users(id,email,aud,role,instance_id) values
    (uo,'fx-owner@test.local','authenticated','authenticated','00000000-0000-0000-0000-000000000000'),
    (um,'fx-member@test.local','authenticated','authenticated','00000000-0000-0000-0000-000000000000'),
    (ux,'fx-outsider@test.local','authenticated','authenticated','00000000-0000-0000-0000-000000000000');
  perform set_config('request.jwt.claims', json_build_object('sub',uo,'role','authenticated')::text, true); execute 'set local role authenticated';
  o := public.create_organization('FX fixture','Main');
  execute 'reset role'; perform set_config('request.jwt.claims', json_build_object('sub',ux,'role','authenticated')::text, true); execute 'set local role authenticated';
  o2 := public.create_organization('FX other','Other');
  execute 'reset role';
  insert into public.organization_members(org_id,user_id,role) values(o,um,'member');
  -- a member's visit can import (the numbers come from the server), but never without the server proof
  perform set_config('request.jwt.claims', json_build_object('sub',um,'role','authenticated')::text, true); execute 'set local role authenticated';
  begin perform public.import_official_rates_verified(o,current_date,rates,'forged'); fail:=fail+1; failures:=failures||' forged_proof'; exception when others then if sqlstate in ('P0001','42501','23514','23505','23503') then pass:=pass+1; else fail:=fail+1; failures:=failures||' unexpected:'||sqlstate||':'||left(sqlerrm,60); end if; end;
  n := public.import_official_rates_verified(o,current_date,rates,'rollback-fixture-only');
  if n=2 then pass:=pass+1; else fail:=fail+1; failures:=failures||' first_import:'||n; end if;
  n := public.import_official_rates_verified(o,current_date,rates,'rollback-fixture-only');
  if n=0 then pass:=pass+1; else fail:=fail+1; failures:=failures||' second_import:'||n; end if;
  select kind into k from public.exchange_rates where org_id=o and quote_currency='USD';
  if k='official' then pass:=pass+1; else fail:=fail+1; failures:=failures||' kind'; end if;
  select count(*) into n from public.exchange_rates where org_id=o and base_currency='EUR' and source ilike 'ECB%';
  if n=2 then pass:=pass+1; else fail:=fail+1; failures:=failures||' stored:'||n; end if;
  begin perform public.import_official_rates_verified(o,current_date+1,rates,'rollback-fixture-only'); fail:=fail+1; failures:=failures||' future'; exception when others then if sqlstate in ('P0001','42501','23514','23505','23503') then pass:=pass+1; else fail:=fail+1; failures:=failures||' unexpected:'||sqlstate||':'||left(sqlerrm,60); end if; end;
  begin perform public.import_official_rates_verified(o,current_date-120,rates,'rollback-fixture-only'); fail:=fail+1; failures:=failures||' too_old'; exception when others then if sqlstate in ('P0001','42501','23514','23505','23503') then pass:=pass+1; else fail:=fail+1; failures:=failures||' unexpected:'||sqlstate||':'||left(sqlerrm,60); end if; end;
  begin perform public.import_official_rates_verified(o,current_date,'[{"currency":"EUR","rate":"1"}]','rollback-fixture-only'); fail:=fail+1; failures:=failures||' eur_quote'; exception when others then if sqlstate in ('P0001','42501','23514','23505','23503') then pass:=pass+1; else fail:=fail+1; failures:=failures||' unexpected:'||sqlstate||':'||left(sqlerrm,60); end if; end;
  begin perform public.import_official_rates_verified(o,current_date,'[{"currency":"USD","rate":"-1"}]','rollback-fixture-only'); fail:=fail+1; failures:=failures||' negative'; exception when others then if sqlstate in ('P0001','42501','23514','23505','23503') then pass:=pass+1; else fail:=fail+1; failures:=failures||' unexpected:'||sqlstate||':'||left(sqlerrm,60); end if; end;
  begin perform public.import_official_rates_verified(o,current_date,'[{"currency":"USD","rate":"abc"}]','rollback-fixture-only'); fail:=fail+1; failures:=failures||' not_number'; exception when others then if sqlstate in ('P0001','42501','23514','23505','23503') then pass:=pass+1; else fail:=fail+1; failures:=failures||' unexpected:'||sqlstate||':'||left(sqlerrm,60); end if; end;
  -- browsers cannot insert official rows directly
  begin insert into public.exchange_rates(org_id,base_currency,quote_currency,rate,rate_date,source,kind) values(o,'EUR','CHF',1,current_date,'ECB','official'); fail:=fail+1; failures:=failures||' direct_insert'; exception when others then if sqlstate in ('P0001','42501','23514','23505','23503') then pass:=pass+1; else fail:=fail+1; failures:=failures||' unexpected:'||sqlstate||':'||left(sqlerrm,60); end if; end;
  -- outsiders can neither import into nor read another organization's rates
  execute 'reset role'; perform set_config('request.jwt.claims', json_build_object('sub',ux,'role','authenticated')::text, true); execute 'set local role authenticated';
  begin perform public.import_official_rates_verified(o,current_date,rates,'rollback-fixture-only'); fail:=fail+1; failures:=failures||' outsider_import'; exception when others then if sqlstate in ('P0001','42501','23514','23505','23503') then pass:=pass+1; else fail:=fail+1; failures:=failures||' unexpected:'||sqlstate||':'||left(sqlerrm,60); end if; end;
  select count(*) into n from public.exchange_rates where org_id=o; if n=0 then pass:=pass+1; else fail:=fail+1; failures:=failures||' outsider_read'; end if;
  execute 'reset role';
  begin update public.exchange_rates set rate=2 where org_id=o and quote_currency='USD'; fail:=fail+1; failures:=failures||' permanent'; exception when others then if sqlstate in ('P0001','42501','23514','23505','23503') then pass:=pass+1; else fail:=fail+1; failures:=failures||' unexpected:'||sqlstate||':'||left(sqlerrm,60); end if; end;
  -- an owner can still record a manual rate for the same pair and date; it stays labelled manual
  perform set_config('request.jwt.claims', json_build_object('sub',uo,'role','authenticated')::text, true); execute 'set local role authenticated';
  perform public.record_exchange_rate(o,'EUR','USD',1.1,current_date,'Bank statement');
  execute 'reset role';
  select count(*) into n from public.exchange_rates where org_id=o and quote_currency='USD' and kind='manual'; if n=1 then pass:=pass+1; else fail:=fail+1; failures:=failures||' manual_coexists'; end if;
  raise exception 'OFFICIAL_RATES_RESULT pass=% fail=% failures=[%]', pass, fail, failures;
end $$;
