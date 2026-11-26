-- Additive proposal only. NOT applied to production or staging in execution correction 2.
-- The current platform migration tool cannot target the owner-authorized staging instance.
-- Public visitors get narrow capability RPCs, never table access or CRM/tenant identifiers.
CREATE TABLE IF NOT EXISTS public.lead_forms (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), org_id uuid NOT NULL REFERENCES public.organizations(id),
 workspace_id uuid NOT NULL REFERENCES public.workspaces(id), form_key text UNIQUE NOT NULL CHECK(form_key ~ '^[a-z0-9-]{8,64}$'),
 business_name text NOT NULL CHECK(length(trim(business_name)) BETWEEN 1 AND 160),
 privacy_url text NOT NULL CHECK(privacy_url ~ '^https://' AND length(privacy_url)<=1000),
 copy jsonb NOT NULL, active boolean NOT NULL DEFAULT false,
 daily_limit integer NOT NULL DEFAULT 100 CHECK(daily_limit BETWEEN 1 AND 1000),
 hourly_limit integer NOT NULL DEFAULT 30 CHECK(hourly_limit BETWEEN 1 AND 100),
 created_by uuid NOT NULL, created_at timestamptz NOT NULL DEFAULT now(), UNIQUE(id,org_id,workspace_id)
);
REVOKE ALL ON public.lead_forms FROM PUBLIC, anon, authenticated;
GRANT SELECT ON public.lead_forms TO authenticated;
GRANT SELECT,INSERT,UPDATE,DELETE ON public.lead_forms TO service_role;
ALTER TABLE public.lead_forms ENABLE ROW LEVEL SECURITY;
CREATE POLICY lead_forms_read ON public.lead_forms FOR SELECT TO authenticated USING(public.has_workspace_role(workspace_id,'viewer'));

CREATE TABLE IF NOT EXISTS public.lead_sessions (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), form_id uuid NOT NULL REFERENCES public.lead_forms(id),
 created_at timestamptz NOT NULL DEFAULT now(), used_at timestamptz
);
REVOKE ALL ON public.lead_sessions FROM PUBLIC, anon, authenticated;
GRANT SELECT,INSERT,UPDATE,DELETE ON public.lead_sessions TO service_role;
ALTER TABLE public.lead_sessions ENABLE ROW LEVEL SECURITY;
CREATE INDEX lead_sessions_limit ON public.lead_sessions(form_id,created_at);

CREATE TABLE IF NOT EXISTS public.lead_submissions (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), org_id uuid NOT NULL, workspace_id uuid NOT NULL,
 form_id uuid NOT NULL, contact_id uuid NOT NULL REFERENCES public.crm_contacts(id), request_id uuid NOT NULL,
 name text NOT NULL CHECK(length(trim(name)) BETWEEN 1 AND 120), email text NOT NULL CHECK(length(email)<=255),
 phone text NOT NULL DEFAULT '' CHECK(length(phone)<=40), message text NOT NULL DEFAULT '' CHECK(length(message)<=2000),
 locale text NOT NULL CHECK(locale IN ('en','nl','fr')), consent_text text NOT NULL,
 privacy_url text NOT NULL, attribution jsonb NOT NULL DEFAULT '{}',
 submission_day date NOT NULL, payload_hash text NOT NULL, created_at timestamptz NOT NULL DEFAULT now(),
 FOREIGN KEY(form_id,org_id,workspace_id) REFERENCES public.lead_forms(id,org_id,workspace_id),
 UNIQUE(form_id,email,submission_day), UNIQUE(form_id,request_id), UNIQUE(id,org_id,workspace_id)
);
REVOKE ALL ON public.lead_submissions FROM PUBLIC, anon, authenticated;
GRANT SELECT ON public.lead_submissions TO authenticated;
GRANT SELECT,INSERT,UPDATE,DELETE ON public.lead_submissions TO service_role;
ALTER TABLE public.lead_submissions ENABLE ROW LEVEL SECURITY;
CREATE POLICY lead_submissions_read ON public.lead_submissions FOR SELECT TO authenticated USING(public.has_workspace_role(workspace_id,'viewer'));
CREATE INDEX lead_submissions_scope ON public.lead_submissions(org_id,workspace_id,id);
CREATE INDEX lead_submissions_limit ON public.lead_submissions(form_id,created_at);

CREATE TABLE IF NOT EXISTS public.lead_decisions (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), org_id uuid NOT NULL, workspace_id uuid NOT NULL,
 submission_id uuid NOT NULL, decision text NOT NULL CHECK(decision IN ('qualified','not_fit')),
 note text NOT NULL CHECK(length(trim(note)) BETWEEN 1 AND 1000), created_by uuid NOT NULL,
 created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 FOREIGN KEY(submission_id,org_id,workspace_id) REFERENCES public.lead_submissions(id,org_id,workspace_id)
);
REVOKE ALL ON public.lead_decisions FROM PUBLIC, anon, authenticated;
GRANT SELECT ON public.lead_decisions TO authenticated;
GRANT SELECT,INSERT,UPDATE,DELETE ON public.lead_decisions TO service_role;
ALTER TABLE public.lead_decisions ENABLE ROW LEVEL SECURITY;
CREATE POLICY lead_decisions_read ON public.lead_decisions FOR SELECT TO authenticated USING(public.has_workspace_role(workspace_id,'viewer'));
CREATE INDEX lead_decisions_scope ON public.lead_decisions(org_id,workspace_id,id);

CREATE TABLE IF NOT EXISTS public.lead_followups (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), org_id uuid NOT NULL, workspace_id uuid NOT NULL,
 submission_id uuid UNIQUE NOT NULL, task_id uuid UNIQUE NOT NULL REFERENCES public.tasks(id),
 created_by uuid NOT NULL, created_at timestamptz NOT NULL DEFAULT now(),
 FOREIGN KEY(submission_id,org_id,workspace_id) REFERENCES public.lead_submissions(id,org_id,workspace_id)
);
REVOKE ALL ON public.lead_followups FROM PUBLIC, anon, authenticated;
GRANT SELECT ON public.lead_followups TO authenticated;
GRANT SELECT,INSERT,UPDATE,DELETE ON public.lead_followups TO service_role;
ALTER TABLE public.lead_followups ENABLE ROW LEVEL SECURITY;
CREATE POLICY lead_followups_read ON public.lead_followups FOR SELECT TO authenticated USING(public.has_workspace_role(workspace_id,'viewer'));

CREATE OR REPLACE FUNCTION public.lead_history_immutable() RETURNS trigger LANGUAGE plpgsql SET search_path=public AS $$
BEGIN RAISE EXCEPTION 'lead_history_immutable'; END $$;
CREATE TRIGGER lead_submission_immutable BEFORE UPDATE OR DELETE ON public.lead_submissions FOR EACH ROW EXECUTE FUNCTION public.lead_history_immutable();
CREATE TRIGGER lead_decision_immutable BEFORE UPDATE OR DELETE ON public.lead_decisions FOR EACH ROW EXECUTE FUNCTION public.lead_history_immutable();
CREATE TRIGGER lead_followup_immutable BEFORE UPDATE OR DELETE ON public.lead_followups FOR EACH ROW EXECUTE FUNCTION public.lead_history_immutable();
REVOKE ALL ON FUNCTION public.lead_history_immutable() FROM PUBLIC,anon,authenticated;

CREATE OR REPLACE FUNCTION public.lead_form_scope_guard() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
BEGIN
 IF TG_OP='INSERT' THEN
  IF NOT EXISTS(SELECT 1 FROM public.workspaces WHERE id=NEW.workspace_id AND org_id=NEW.org_id) THEN RAISE EXCEPTION 'lead_scope'; END IF;
 ELSE
  IF NEW.org_id IS DISTINCT FROM OLD.org_id OR NEW.workspace_id IS DISTINCT FROM OLD.workspace_id
   OR NEW.form_key IS DISTINCT FROM OLD.form_key OR NEW.created_by IS DISTINCT FROM OLD.created_by
   OR NEW.created_at IS DISTINCT FROM OLD.created_at THEN RAISE EXCEPTION 'lead_scope_immutable'; END IF;
 END IF;
 RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION public.lead_form_scope_guard() FROM PUBLIC,anon,authenticated;
CREATE TRIGGER lead_form_scope BEFORE INSERT OR UPDATE ON public.lead_forms FOR EACH ROW EXECUTE FUNCTION public.lead_form_scope_guard();

-- All CRM writers share the same email lock; existing duplicate rows are never merged or deleted.
CREATE OR REPLACE FUNCTION public.guard_crm_lead_email() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE email_normal text;
BEGIN
 email_normal:=lower(trim(NEW.email));
 IF email_normal='' THEN RETURN NEW; END IF;
 IF TG_OP='UPDATE' AND lower(trim(OLD.email))=email_normal THEN RETURN NEW; END IF;
 PERFORM pg_advisory_xact_lock(hashtextextended('lead-contact:'||NEW.workspace_id::text||':'||email_normal,0));
 IF EXISTS(SELECT 1 FROM public.crm_contacts WHERE org_id=NEW.org_id AND workspace_id=NEW.workspace_id AND lower(trim(email))=email_normal AND id<>NEW.id) THEN RAISE EXCEPTION 'lead_contact_duplicate'; END IF;
 RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION public.guard_crm_lead_email() FROM PUBLIC,anon,authenticated;
CREATE TRIGGER crm_lead_email BEFORE INSERT OR UPDATE OF email ON public.crm_contacts FOR EACH ROW EXECUTE FUNCTION public.guard_crm_lead_email();

CREATE OR REPLACE FUNCTION public.configure_lead_form(_input jsonb) RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE w public.workspaces; f public.lead_forms; l text; c jsonb; fid uuid; sanitized jsonb:='{}';
BEGIN
 SELECT * INTO w FROM public.workspaces WHERE id=(_input->>'workspaceId')::uuid;
 IF w.id IS NULL OR NOT public.has_workspace_role(w.id,'admin') THEN RAISE EXCEPTION 'lead_denied' USING ERRCODE='42501'; END IF;
 IF jsonb_typeof(_input) IS DISTINCT FROM 'object' OR octet_length(_input::text)>12000 OR coalesce(_input->>'key','') !~ '^[a-z0-9-]{8,64}$'
 OR length(trim(coalesce(_input->>'businessName',''))) NOT BETWEEN 1 AND 160
 OR coalesce(_input->>'privacyUrl','') !~ '^https://[^[:space:]]+$' OR length(_input->>'privacyUrl')>1000
 OR jsonb_typeof(_input->'active') IS DISTINCT FROM 'boolean'
 OR coalesce((_input->>'dailyLimit')::int,0) NOT BETWEEN 1 AND 1000
 OR coalesce((_input->>'hourlyLimit')::int,0) NOT BETWEEN 1 AND 100 THEN RAISE EXCEPTION 'lead_invalid'; END IF;
 FOREACH l IN ARRAY ARRAY['en','nl','fr'] LOOP
  c:=_input->'copy'->l;
  IF jsonb_typeof(c) IS DISTINCT FROM 'object' OR jsonb_typeof(c->'title') IS DISTINCT FROM 'string'
   OR jsonb_typeof(c->'intro') IS DISTINCT FROM 'string' OR jsonb_typeof(c->'consent') IS DISTINCT FROM 'string'
   OR length(trim(coalesce(c->>'title',''))) NOT BETWEEN 1 AND 160
   OR length(coalesce(c->>'intro',''))>600 OR length(trim(coalesce(c->>'consent',''))) NOT BETWEEN 20 AND 1000 THEN RAISE EXCEPTION 'lead_invalid'; END IF;
  sanitized:=sanitized||jsonb_build_object(l,jsonb_build_object('title',trim(c->>'title'),'intro',trim(c->>'intro'),'consent',trim(c->>'consent')));
 END LOOP;
 -- Global slug lock avoids concurrent cross-business claiming. A form's association never changes.
 PERFORM pg_advisory_xact_lock(hashtextextended('lead-key:'||(_input->>'key'),0));
 SELECT * INTO f FROM public.lead_forms WHERE form_key=_input->>'key' FOR UPDATE;
 IF f.id IS NOT NULL AND (f.workspace_id<>w.id OR f.org_id<>w.org_id) THEN RAISE EXCEPTION 'lead_unavailable'; END IF;
 IF f.id IS NULL THEN
  INSERT INTO public.lead_forms(org_id,workspace_id,form_key,business_name,privacy_url,copy,active,daily_limit,hourly_limit,created_by)
  VALUES(w.org_id,w.id,_input->>'key',trim(_input->>'businessName'),_input->>'privacyUrl',sanitized,(_input->>'active')::boolean,(_input->>'dailyLimit')::int,(_input->>'hourlyLimit')::int,auth.uid()) RETURNING id INTO fid;
 ELSE
  UPDATE public.lead_forms SET business_name=trim(_input->>'businessName'),privacy_url=_input->>'privacyUrl',copy=sanitized,active=(_input->>'active')::boolean,daily_limit=(_input->>'dailyLimit')::int,hourly_limit=(_input->>'hourlyLimit')::int WHERE id=f.id RETURNING id INTO fid;
 END IF;
 INSERT INTO public.audit_logs(org_id,actor_id,action,target_type,target_id,metadata)
 VALUES(w.org_id,auth.uid(),'lead_form_configured','lead_forms',fid::text,jsonb_build_object('workspace_id',w.id,'active',_input->'active'));
 RETURN fid;
END $$;
REVOKE ALL ON FUNCTION public.configure_lead_form(jsonb) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.configure_lead_form(jsonb) TO authenticated;

CREATE OR REPLACE FUNCTION public.public_lead_form(_key text) RETURNS jsonb LANGUAGE sql STABLE SECURITY DEFINER SET search_path=public AS $$
 SELECT jsonb_build_object('key',form_key,'businessName',business_name,'privacyUrl',privacy_url,'copy',copy)
 FROM public.lead_forms WHERE form_key=_key AND active AND length(_key) BETWEEN 8 AND 64;
$$;
REVOKE ALL ON FUNCTION public.public_lead_form(text) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.public_lead_form(text) TO anon,authenticated;

CREATE OR REPLACE FUNCTION public.open_lead_session(_key text) RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE f public.lead_forms; sid uuid;
BEGIN
 SELECT * INTO f FROM public.lead_forms WHERE form_key=_key AND active FOR UPDATE;
 IF f.id IS NULL THEN RAISE EXCEPTION 'lead_unavailable'; END IF;
 IF (SELECT count(*) FROM public.lead_sessions WHERE form_id=f.id AND created_at>clock_timestamp()-interval '1 hour')>=f.hourly_limit THEN RAISE EXCEPTION 'lead_limited'; END IF;
 INSERT INTO public.lead_sessions(form_id) VALUES(f.id) RETURNING id INTO sid;
 RETURN sid;
END $$;
REVOKE ALL ON FUNCTION public.open_lead_session(text) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.open_lead_session(text) TO anon,authenticated;

CREATE OR REPLACE FUNCTION public.submit_public_lead(_input jsonb) RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE f public.lead_forms; s public.lead_sessions; c public.crm_contacts; existing public.lead_submissions;
 email_normal text; cid uuid; sid uuid; rid uuid; n timestamptz:=clock_timestamp(); day date; l text; fingerprint text;
BEGIN
 FOREACH l IN ARRAY ARRAY['formKey','name','email','locale','consentText','privacyUrl','sessionId','requestId'] LOOP
  IF jsonb_typeof(_input->l) IS DISTINCT FROM 'string' THEN RAISE EXCEPTION 'lead_invalid'; END IF;
 END LOOP;
 IF jsonb_typeof(_input) IS DISTINCT FROM 'object' OR octet_length(_input::text)>16000
 OR _input->'consent' IS DISTINCT FROM 'true'::jsonb OR coalesce(_input->>'website','')<>''
 OR length(trim(coalesce(_input->>'name',''))) NOT BETWEEN 1 AND 120
 OR length(coalesce(_input->>'phone',''))>40 OR length(coalesce(_input->>'message',''))>2000
 OR coalesce(_input->>'locale','') NOT IN ('en','nl','fr')
 OR jsonb_typeof(_input->'attribution') IS DISTINCT FROM 'object'
 THEN RAISE EXCEPTION 'lead_invalid'; END IF;
 FOREACH l IN ARRAY ARRAY['source','medium','campaign'] LOOP
  IF jsonb_typeof(_input->'attribution'->l) IS DISTINCT FROM 'string' OR length(_input->'attribution'->>l)>120 THEN RAISE EXCEPTION 'lead_invalid'; END IF;
 END LOOP;
 email_normal:=lower(trim(coalesce(_input->>'email','')));
 IF length(email_normal)>255 OR email_normal !~ '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$' THEN RAISE EXCEPTION 'lead_invalid'; END IF;
 rid:=(_input->>'requestId')::uuid;
 IF rid IS NULL THEN RAISE EXCEPTION 'lead_invalid'; END IF;
 SELECT * INTO f FROM public.lead_forms WHERE form_key=_input->>'formKey' AND active FOR UPDATE;
 IF f.id IS NULL THEN RAISE EXCEPTION 'lead_unavailable'; END IF;
 day:=(n AT TIME ZONE 'UTC')::date;
 fingerprint:=encode(sha256(convert_to((_input - 'sessionId' - 'requestId')::text,'UTF8')),'hex');
 SELECT * INTO existing FROM public.lead_submissions WHERE form_id=f.id AND request_id=rid;
 IF existing.id IS NOT NULL THEN
  IF existing.payload_hash<>fingerprint THEN RAISE EXCEPTION 'lead_invalid'; END IF;
  RETURN true;
 END IF;
 IF _input->>'consentText' IS DISTINCT FROM f.copy->(_input->>'locale')->>'consent'
 OR _input->>'privacyUrl' IS DISTINCT FROM f.privacy_url THEN RAISE EXCEPTION 'lead_expired'; END IF;
 SELECT * INTO s FROM public.lead_sessions WHERE id=(_input->>'sessionId')::uuid AND form_id=f.id FOR UPDATE;
 IF s.id IS NULL OR s.used_at IS NOT NULL OR n<s.created_at+interval '3 seconds' OR n>s.created_at+interval '2 hours' THEN RAISE EXCEPTION 'lead_expired'; END IF;
 -- One accepted request per normalized email/form/UTC day. No existence disclosure in the result.
 IF EXISTS(SELECT 1 FROM public.lead_submissions WHERE form_id=f.id AND email=email_normal AND submission_day=day) THEN
  UPDATE public.lead_sessions SET used_at=n WHERE id=s.id; RETURN true;
 END IF;
 IF (SELECT count(*) FROM public.lead_submissions WHERE form_id=f.id AND submission_day=day)>=f.daily_limit THEN RAISE EXCEPTION 'lead_limited'; END IF;
 -- Serialize CRM dedupe across ALL forms for this business, not just this form.
 PERFORM pg_advisory_xact_lock(hashtextextended('lead-contact:'||f.workspace_id::text||':'||email_normal,0));
 IF (SELECT count(*) FROM public.crm_contacts WHERE org_id=f.org_id AND workspace_id=f.workspace_id AND lower(trim(email))=email_normal)>1 THEN RAISE EXCEPTION 'lead_unavailable'; END IF;
 SELECT * INTO c FROM public.crm_contacts WHERE org_id=f.org_id AND workspace_id=f.workspace_id AND lower(trim(email))=email_normal FOR UPDATE;
 IF c.id IS NOT NULL AND c.status<>'active' THEN RAISE EXCEPTION 'lead_unavailable'; END IF;
 IF c.id IS NULL THEN
  INSERT INTO public.crm_contacts(org_id,workspace_id,name,email,phone,source,created_by)
  VALUES(f.org_id,f.workspace_id,trim(_input->>'name'),email_normal,coalesce(_input->>'phone',''),left('lead-form:'||f.form_key,80),f.created_by) RETURNING id INTO cid;
 ELSE
  cid:=c.id;
  -- Keep first source/name and existing details. Every later enquiry retains its own immutable snapshot.
  IF c.phone='' AND coalesce(_input->>'phone','')<>'' THEN UPDATE public.crm_contacts SET phone=_input->>'phone' WHERE id=c.id; END IF;
 END IF;
 INSERT INTO public.lead_submissions(org_id,workspace_id,form_id,contact_id,request_id,name,email,phone,message,locale,consent_text,privacy_url,attribution,submission_day,payload_hash)
 VALUES(f.org_id,f.workspace_id,f.id,cid,rid,trim(_input->>'name'),email_normal,coalesce(_input->>'phone',''),coalesce(_input->>'message',''),_input->>'locale',f.copy->(_input->>'locale')->>'consent',f.privacy_url,_input->'attribution',day,fingerprint) RETURNING id INTO sid;
 UPDATE public.lead_sessions SET used_at=n WHERE id=s.id;
 INSERT INTO public.audit_logs(org_id,actor_id,action,target_type,target_id,metadata)
 VALUES(f.org_id,NULL,'lead_received','lead_submissions',sid::text,jsonb_build_object('workspace_id',f.workspace_id,'form_id',f.id,'contact_id',cid));
 RETURN true;
END $$;
REVOKE ALL ON FUNCTION public.submit_public_lead(jsonb) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.submit_public_lead(jsonb) TO anon,authenticated;

CREATE OR REPLACE FUNCTION public.qualify_lead(_submission uuid,_decision text,_note text) RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE s public.lead_submissions; did uuid;
BEGIN
 SELECT * INTO s FROM public.lead_submissions WHERE id=_submission FOR UPDATE;
 IF s.id IS NULL OR NOT public.has_workspace_role(s.workspace_id,'member') THEN RAISE EXCEPTION 'lead_denied' USING ERRCODE='42501'; END IF;
 IF _decision NOT IN ('qualified','not_fit') OR length(trim(coalesce(_note,''))) NOT BETWEEN 1 AND 1000 THEN RAISE EXCEPTION 'lead_invalid'; END IF;
 INSERT INTO public.lead_decisions(org_id,workspace_id,submission_id,decision,note,created_by) VALUES(s.org_id,s.workspace_id,s.id,_decision,trim(_note),auth.uid()) RETURNING id INTO did;
 INSERT INTO public.audit_logs(org_id,actor_id,action,target_type,target_id,metadata) VALUES(s.org_id,auth.uid(),'lead_qualified','lead_submissions',s.id::text,jsonb_build_object('decision_id',did,'decision',_decision,'workspace_id',s.workspace_id));
 RETURN did;
END $$;
REVOKE ALL ON FUNCTION public.qualify_lead(uuid,text,text) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.qualify_lead(uuid,text,text) TO authenticated;

CREATE OR REPLACE FUNCTION public.prepare_lead_followup(_submission uuid,_title text,_due date DEFAULT NULL) RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE s public.lead_submissions; d public.lead_decisions; tid uuid;
BEGIN
 SELECT * INTO s FROM public.lead_submissions WHERE id=_submission FOR UPDATE;
 IF s.id IS NULL OR NOT public.has_workspace_role(s.workspace_id,'member') THEN RAISE EXCEPTION 'lead_denied' USING ERRCODE='42501'; END IF;
 SELECT task_id INTO tid FROM public.lead_followups WHERE submission_id=s.id;
 IF tid IS NOT NULL THEN RETURN tid; END IF;
 SELECT * INTO d FROM public.lead_decisions WHERE submission_id=s.id ORDER BY created_at DESC,id DESC LIMIT 1;
 IF d.id IS NULL OR d.decision<>'qualified' OR length(trim(coalesce(_title,''))) NOT BETWEEN 1 AND 200 THEN RAISE EXCEPTION 'lead_invalid'; END IF;
 INSERT INTO public.tasks(org_id,workspace_id,title,description,due_date,created_by,labels)
 VALUES(s.org_id,s.workspace_id,trim(_title),'Internal follow-up only. No communication is authorized.'||E'\nSubmission: '||s.id::text||E'\nContact: '||s.contact_id::text||E'\nQualification: '||d.note,_due,auth.uid(),ARRAY['lead-followup','lead:'||s.id::text]) RETURNING id INTO tid;
 INSERT INTO public.lead_followups(org_id,workspace_id,submission_id,task_id,created_by) VALUES(s.org_id,s.workspace_id,s.id,tid,auth.uid());
 INSERT INTO public.audit_logs(org_id,actor_id,action,target_type,target_id,metadata) VALUES(s.org_id,auth.uid(),'lead_followup_prepared','lead_submissions',s.id::text,jsonb_build_object('task_id',tid,'workspace_id',s.workspace_id));
 RETURN tid;
END $$;
REVOKE ALL ON FUNCTION public.prepare_lead_followup(uuid,text,date) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.prepare_lead_followup(uuid,text,date) TO authenticated;
