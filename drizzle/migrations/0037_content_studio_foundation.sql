CREATE TABLE public.writing_profiles (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), org_id uuid NOT NULL REFERENCES public.organizations(id), workspace_id uuid NOT NULL REFERENCES public.workspaces(id), name text NOT NULL CHECK(length(trim(name)) BETWEEN 1 AND 120), tone text NOT NULL DEFAULT '' CHECK(length(tone)<=500), style text NOT NULL DEFAULT '' CHECK(length(style)<=2000), audience text NOT NULL DEFAULT '' CHECK(length(audience)<=1000), channels text[] NOT NULL DEFAULT '{}', examples text NOT NULL DEFAULT '' CHECK(length(examples)<=20000), examples_authorized boolean NOT NULL DEFAULT false, CHECK(examples='' OR examples_authorized), created_by uuid NOT NULL DEFAULT auth.uid(), created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(), UNIQUE(id,org_id,workspace_id));
GRANT SELECT, INSERT, UPDATE ON public.writing_profiles TO authenticated; GRANT ALL ON public.writing_profiles TO service_role;
ALTER TABLE public.writing_profiles ENABLE ROW LEVEL SECURITY;
CREATE TABLE public.content_assets (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), org_id uuid NOT NULL REFERENCES public.organizations(id), workspace_id uuid NOT NULL REFERENCES public.workspaces(id), title text NOT NULL CHECK(length(trim(title)) BETWEEN 1 AND 200), channel text NOT NULL DEFAULT 'blog' CHECK(channel IN ('blog','linkedin','email','website','social','ad')), draft_body text NOT NULL DEFAULT '' CHECK(length(draft_body)<=100000), status text NOT NULL DEFAULT 'draft' CHECK(status IN ('draft','in_review','archived')), planned_date date, campaign_id uuid, writing_profile_id uuid, created_by uuid NOT NULL DEFAULT auth.uid(), created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(), UNIQUE(id,org_id,workspace_id), FOREIGN KEY(campaign_id,org_id,workspace_id) REFERENCES public.campaigns(id,org_id,workspace_id), FOREIGN KEY(writing_profile_id,org_id,workspace_id) REFERENCES public.writing_profiles(id,org_id,workspace_id));
GRANT SELECT, INSERT, UPDATE ON public.content_assets TO authenticated; GRANT ALL ON public.content_assets TO service_role;
ALTER TABLE public.content_assets ENABLE ROW LEVEL SECURITY;
CREATE TABLE public.content_versions (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), org_id uuid NOT NULL, workspace_id uuid NOT NULL, asset_id uuid NOT NULL, version_no int NOT NULL, title text NOT NULL, body text NOT NULL CHECK(length(body)<=100000), note text NOT NULL DEFAULT '' CHECK(length(note)<=500), restored_from uuid REFERENCES public.content_versions(id), created_by uuid NOT NULL, created_at timestamptz NOT NULL DEFAULT now(), UNIQUE(asset_id,version_no), FOREIGN KEY(asset_id,org_id,workspace_id) REFERENCES public.content_assets(id,org_id,workspace_id));
GRANT SELECT ON public.content_versions TO authenticated; GRANT ALL ON public.content_versions TO service_role;
ALTER TABLE public.content_versions ENABLE ROW LEVEL SECURITY;
CREATE TABLE public.content_version_decisions (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), org_id uuid NOT NULL, workspace_id uuid NOT NULL, version_id uuid NOT NULL UNIQUE REFERENCES public.content_versions(id), body_hash text NOT NULL, decision text NOT NULL CHECK(decision IN ('approved','rejected')), note text NOT NULL DEFAULT '' CHECK(length(note)<=1000), decided_by uuid NOT NULL, decided_at timestamptz NOT NULL DEFAULT now());
GRANT SELECT ON public.content_version_decisions TO authenticated; GRANT ALL ON public.content_version_decisions TO service_role;
ALTER TABLE public.content_version_decisions ENABLE ROW LEVEL SECURITY;
CREATE OR REPLACE FUNCTION public.guard_content_scope() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$ BEGIN
 IF TG_OP='INSERT' THEN
  IF NOT EXISTS(SELECT 1 FROM public.workspaces w WHERE w.id=NEW.workspace_id AND w.org_id=NEW.org_id) THEN RAISE EXCEPTION 'workspace does not belong to organization'; END IF;
 ELSE
  IF NEW.org_id IS DISTINCT FROM OLD.org_id OR NEW.workspace_id IS DISTINCT FROM OLD.workspace_id OR NEW.created_by IS DISTINCT FROM OLD.created_by OR NEW.created_at IS DISTINCT FROM OLD.created_at THEN RAISE EXCEPTION 'scope and authorship are immutable'; END IF;
  NEW.updated_at:=now();
 END IF; RETURN NEW; END $$;
DO $$ DECLARE t text; BEGIN FOREACH t IN ARRAY ARRAY['writing_profiles','content_assets'] LOOP
 EXECUTE format('CREATE POLICY content_read ON public.%I FOR SELECT TO authenticated USING(public.has_workspace_role(workspace_id,''viewer''))',t);
 EXECUTE format('CREATE POLICY content_create ON public.%I FOR INSERT TO authenticated WITH CHECK(public.has_workspace_role(workspace_id,''member'') AND created_by=auth.uid())',t);
 EXECUTE format('CREATE POLICY content_update ON public.%I FOR UPDATE TO authenticated USING(public.has_workspace_role(workspace_id,''member'')) WITH CHECK(public.has_workspace_role(workspace_id,''member''))',t);
 EXECUTE format('CREATE TRIGGER content_scope_guard BEFORE INSERT OR UPDATE ON public.%I FOR EACH ROW EXECUTE FUNCTION public.guard_content_scope()',t);
END LOOP; END $$;
CREATE POLICY content_versions_read ON public.content_versions FOR SELECT TO authenticated USING(public.has_workspace_role(workspace_id,'viewer'));
CREATE POLICY content_decisions_read ON public.content_version_decisions FOR SELECT TO authenticated USING(public.has_workspace_role(workspace_id,'viewer'));
CREATE OR REPLACE FUNCTION public.save_content_version(_asset uuid,_note text DEFAULT '',_restore_from uuid DEFAULT NULL) RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$ DECLARE a public.content_assets; src public.content_versions; n int; vid uuid; b text; t text; BEGIN
 SELECT * INTO a FROM public.content_assets WHERE id=_asset FOR UPDATE;
 IF a.id IS NULL OR NOT public.has_workspace_role(a.workspace_id,'member') THEN RAISE EXCEPTION 'not authorized' USING ERRCODE='42501'; END IF;
 b:=a.draft_body; t:=a.title;
 IF _restore_from IS NOT NULL THEN SELECT * INTO src FROM public.content_versions WHERE id=_restore_from AND asset_id=_asset; IF src.id IS NULL THEN RAISE EXCEPTION 'version not found'; END IF; b:=src.body; t:=src.title; END IF;
 IF length(trim(b))=0 THEN RAISE EXCEPTION 'content is empty'; END IF;
 SELECT coalesce(max(version_no),0)+1 INTO n FROM public.content_versions WHERE asset_id=_asset;
 INSERT INTO public.content_versions(org_id,workspace_id,asset_id,version_no,title,body,note,restored_from,created_by) VALUES(a.org_id,a.workspace_id,a.id,n,t,b,left(coalesce(_note,''),500),_restore_from,auth.uid()) RETURNING id INTO vid;
 IF _restore_from IS NOT NULL THEN UPDATE public.content_assets SET draft_body=b,title=t WHERE id=_asset; END IF;
 INSERT INTO public.activity_events(org_id,workspace_id,entity_type,entity_id,actor_id,action,metadata) VALUES(a.org_id,a.workspace_id,'content',a.id,auth.uid(),CASE WHEN _restore_from IS NULL THEN 'version_saved' ELSE 'version_restored' END,jsonb_build_object('title',t,'version',n));
 RETURN vid; END $$;
CREATE OR REPLACE FUNCTION public.decide_content_version(_version uuid,_decision text,_note text DEFAULT '') RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$ DECLARE v public.content_versions; did uuid; BEGIN
 SELECT * INTO v FROM public.content_versions WHERE id=_version;
 IF v.id IS NULL OR NOT public.has_workspace_role(v.workspace_id,'admin') THEN RAISE EXCEPTION 'not authorized' USING ERRCODE='42501'; END IF;
 IF _decision NOT IN ('approved','rejected') THEN RAISE EXCEPTION 'invalid decision'; END IF;
 INSERT INTO public.content_version_decisions(org_id,workspace_id,version_id,body_hash,decision,note,decided_by) VALUES(v.org_id,v.workspace_id,v.id,md5(v.title||E'\n'||v.body),_decision,left(coalesce(_note,''),1000),auth.uid()) RETURNING id INTO did;
 INSERT INTO public.activity_events(org_id,workspace_id,entity_type,entity_id,actor_id,action,metadata) VALUES(v.org_id,v.workspace_id,'content',v.asset_id,auth.uid(),'version_'||_decision,jsonb_build_object('title',v.title,'version',v.version_no));
 RETURN did; END $$;
REVOKE ALL ON FUNCTION public.save_content_version(uuid,text,uuid) FROM public,anon; GRANT EXECUTE ON FUNCTION public.save_content_version(uuid,text,uuid) TO authenticated;
REVOKE ALL ON FUNCTION public.decide_content_version(uuid,text,text) FROM public,anon; GRANT EXECUTE ON FUNCTION public.decide_content_version(uuid,text,text) TO authenticated;
REVOKE ALL ON FUNCTION public.guard_content_scope() FROM public,anon,authenticated;
CREATE INDEX content_assets_ws_idx ON public.content_assets(workspace_id,updated_at DESC);
CREATE INDEX content_versions_asset_idx ON public.content_versions(asset_id,version_no DESC);