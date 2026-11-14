-- Self-rolls back. A deliberate exception carries the result; no test rows remain.
do $$
declare u uuid:=gen_random_uuid(); o uuid; amount int; n int; p int:=0;
begin
 insert into auth.users(id,email,aud,role,instance_id) values(u,'monthly@test.local','authenticated','authenticated','00000000-0000-0000-0000-000000000000');
 perform set_config('request.jwt.claims',json_build_object('sub',u,'role','authenticated')::text,true);
 execute 'set local role authenticated'; o:=public.create_organization('Monthly verification','Monthly');
 if public.ensure_monthly_credit_grant(o)=0 then p:=p+1; else raise exception 'Trial was refilled'; end if;
 execute 'reset role'; update public.subscriptions set status='active',plan_key='starter' where org_id=o;
 select monthly_credits into amount from public.plans where key='starter';
 execute 'set local role authenticated';
 if public.ensure_monthly_credit_grant(o)=amount then p:=p+1; else raise exception 'Wrong grant amount'; end if;
 if public.ensure_monthly_credit_grant(o)=0 then p:=p+1; else raise exception 'Duplicate grant'; end if;
 select count(*) into n from public.credit_ledger where org_id=o and ref like 'monthly:%';
 if n=1 then p:=p+1; else raise exception 'Duplicate ledger'; end if;
 execute 'reset role'; update public.subscriptions set status='trialing',trial_ends_at=now()-interval '1 day' where org_id=o;
 execute 'set local role authenticated';
 begin perform public.consume_credits(o,1,'expired-test'); raise exception 'expired trial accepted'; exception when others then if sqlerrm='trial expired' then p:=p+1; else raise; end if; end;
 execute 'reset role'; update public.subscriptions set status='past_due' where org_id=o; execute 'set local role authenticated';
 begin perform public.consume_credits(o,1,'past-due-test'); raise exception 'past due accepted'; exception when others then if sqlerrm='no active subscription' then p:=p+1; else raise; end if; end;
 execute 'reset role'; raise exception 'MONTHLY_RESULT pass=% fail=0',p;
end $$;