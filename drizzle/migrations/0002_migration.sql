
create policy "org members read docs objects" on storage.objects for select to authenticated
  using (bucket_id = 'documents' and public.is_org_member(((storage.foldername(name))[1])::uuid));
create policy "org members upload docs objects" on storage.objects for insert to authenticated
  with check (bucket_id = 'documents' and public.has_org_role(((storage.foldername(name))[1])::uuid, 'member'));
create policy "org admins delete docs objects" on storage.objects for delete to authenticated
  using (bucket_id = 'documents' and public.has_org_role(((storage.foldername(name))[1])::uuid, 'admin'));
