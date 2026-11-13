
create or replace function public.credit_balance(_org uuid) returns int language plpgsql stable security definer set search_path = public as $$
begin
  if not (public.is_org_member(_org) or public.is_platform_staff()) then raise exception 'forbidden'; end if;
  return (select coalesce(sum(delta),0)::int from public.credit_ledger where org_id = _org);
end $$;
create or replace function public.org_entitlement(_org uuid, _feature text) returns int language plpgsql stable security definer set search_path = public as $$
begin
  if not (public.is_org_member(_org) or public.is_platform_staff()) then raise exception 'forbidden'; end if;
  return (select e.limit_value from public.subscriptions s join public.plan_entitlements e on e.plan_key = s.plan_key where s.org_id = _org and e.feature_key = _feature);
end $$;
drop function public.org_has_entitlement_row(uuid,text);
