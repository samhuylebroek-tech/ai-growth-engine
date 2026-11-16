REVOKE INSERT, UPDATE, DELETE, TRUNCATE ON public.content_versions, public.content_version_decisions FROM anon, authenticated;
REVOKE ALL ON public.content_versions, public.content_version_decisions FROM anon;
REVOKE DELETE, TRUNCATE ON public.writing_profiles, public.content_assets FROM anon, authenticated;
REVOKE ALL ON public.writing_profiles, public.content_assets FROM anon;