
drop policy "entitlements readable" on public.plan_entitlements;
create policy "entitlements of public plans readable" on public.plan_entitlements for select to anon, authenticated
  using (exists (select 1 from public.plans p where p.key = plan_key and p.active and p.is_public) or public.is_platform_staff());
