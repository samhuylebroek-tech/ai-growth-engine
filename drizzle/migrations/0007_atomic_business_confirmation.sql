CREATE OR REPLACE FUNCTION public.confirm_business_profile(_workspace uuid, _profile jsonb, _facts jsonb) RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE oid uuid; f jsonb; fid uuid; n int;
BEGIN
 SELECT org_id INTO oid FROM public.workspaces WHERE id=_workspace;
 IF oid IS NULL OR NOT public.has_org_role(oid,'member') THEN RAISE EXCEPTION 'forbidden'; END IF;
 IF jsonb_typeof(_facts) IS DISTINCT FROM 'array' OR jsonb_array_length(_facts) NOT BETWEEN 1 AND 24 OR jsonb_typeof(_profile) IS DISTINCT FROM 'object' THEN RAISE EXCEPTION 'invalid profile'; END IF;
 IF length(coalesce(_profile->>'website',''))>500 OR length(coalesce(_profile->>'description',''))>3000 THEN RAISE EXCEPTION 'profile too long'; END IF;
 IF coalesce((_profile->>'monthly_budget_eur')::numeric,0)<0 OR coalesce((_profile->>'monthly_budget_eur')::numeric,0)>100000000 THEN RAISE EXCEPTION 'invalid budget'; END IF;
 FOR f IN SELECT value FROM jsonb_array_elements(_facts) LOOP
  IF length(coalesce(f->>'key','')) NOT BETWEEN 1 AND 120 OR length(coalesce(f->>'value','')) NOT BETWEEN 1 AND 3000 OR coalesce(f->>'source_type','') NOT IN ('user','website','ai_assumption') OR coalesce((f->>'confidence')::numeric,0) NOT BETWEEN 0 AND 1 THEN RAISE EXCEPTION 'invalid fact'; END IF;
 END LOOP;
 FOR f IN SELECT value FROM jsonb_array_elements(_facts) LOOP
  SELECT id INTO fid FROM public.business_facts WHERE workspace_id=_workspace AND key=f->>'key' AND source_ref IS NOT DISTINCT FROM f->>'source_ref' ORDER BY created_at DESC LIMIT 1;
  IF fid IS NULL THEN
   INSERT INTO public.business_facts(org_id,workspace_id,key,value,source_type,source_ref,confidence,verified) VALUES(oid,_workspace,f->>'key',f->>'value',(f->>'source_type')::public.fact_source,f->>'source_ref',(f->>'confidence')::numeric,coalesce((f->>'verified')::boolean,false));
  ELSE
   UPDATE public.business_facts SET value=f->>'value', confidence=(f->>'confidence')::numeric, verified=coalesce((f->>'verified')::boolean,false) WHERE id=fid;
  END IF;
 END LOOP;
 INSERT INTO public.business_profiles(org_id,workspace_id,website,description,industry,business_model,offerings,audiences,markets,competitors,objectives,monthly_budget_eur,onboarding_completed_at)
 VALUES(oid,_workspace,nullif(_profile->>'website',''),nullif(_profile->>'description',''),nullif(_profile->>'industry',''),nullif(_profile->>'business_model',''),coalesce(_profile->'offerings','[]'),coalesce(_profile->'audiences','[]'),coalesce(_profile->'markets','[]'),coalesce(_profile->'competitors','[]'),coalesce(_profile->'objectives','[]'),(_profile->>'monthly_budget_eur')::numeric,now())
 ON CONFLICT(workspace_id) DO UPDATE SET website=excluded.website,description=excluded.description,industry=excluded.industry,business_model=excluded.business_model,offerings=excluded.offerings,audiences=excluded.audiences,markets=excluded.markets,competitors=excluded.competitors,objectives=excluded.objectives,monthly_budget_eur=excluded.monthly_budget_eur,onboarding_completed_at=now();
 INSERT INTO public.audit_logs(org_id,actor_id,action,target_type,target_id,metadata) VALUES(oid,auth.uid(),'business_profile.confirmed','workspace',_workspace::text,jsonb_build_object('fact_count',jsonb_array_length(_facts)));
END $$;
REVOKE ALL ON FUNCTION public.confirm_business_profile(uuid,jsonb,jsonb) FROM public,anon;
GRANT EXECUTE ON FUNCTION public.confirm_business_profile(uuid,jsonb,jsonb) TO authenticated;