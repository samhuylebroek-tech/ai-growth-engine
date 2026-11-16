REVOKE INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER ON public.single_ai_requests FROM authenticated,anon;
REVOKE SELECT ON public.single_ai_requests FROM anon;
GRANT SELECT ON public.single_ai_requests TO authenticated;