
create or replace function public.shares_org_with(_user uuid) returns boolean language sql stable security definer set search_path = public as $$
  select exists(select 1 from public.organization_members a join public.organization_members b on a.org_id = b.org_id where a.user_id = auth.uid() and b.user_id = _user)
$$;
create policy "co-members read profiles" on public.profiles for select to authenticated using (public.shares_org_with(user_id));
