CREATE TABLE public.competitors (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), org_id uuid NOT NULL REFERENCES public.organizations(id), workspace_id uuid NOT NULL REFERENCES public.workspaces(id), name text NOT NULL CHECK(length(trim(name)) BETWEEN 1 AND 200), website text NOT NULL DEFAULT '' CHECK(length(website)<=500), market text NOT NULL DEFAULT '' CHECK(length(market)<=200), location text NOT NULL DEFAULT '' CHECK(length(location)<=200), category text NOT NULL DEFAULT '' CHECK(length(category)<=200), notes text NOT NULL DEFAULT '' CHECK(length(notes)<=4000), status text NOT NULL DEFAULT 'active' CHECK(status IN ('active','archived')), created_by uuid NOT NULL DEFAULT auth.uid(), created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(), UNIQUE(id,org_id,workspace_id));
GRANT SELECT, INSERT, UPDATE ON public.competitors TO authenticated; GRANT ALL ON public.competitors TO service_role;
ALTER TABLE public.competitors ENABLE ROW LEVEL SECURITY;
CREATE POLICY competitors_read ON public.competitors FOR SELECT TO authenticated USING(public.has_workspace_role(workspace_id,'viewer'));
CREATE POLICY competitors_create ON public.competitors FOR INSERT TO authenticated WITH CHECK(public.has_workspace_role(workspace_id,'member') AND created_by=auth.uid());
CREATE POLICY competitors_update ON public.competitors FOR UPDATE TO authenticated USING(public.has_workspace_role(workspace_id,'member')) WITH CHECK(public.has_workspace_role(workspace_id,'member'));
CREATE TRIGGER competitors_scope_guard BEFORE INSERT OR UPDATE ON public.competitors FOR EACH ROW EXECUTE FUNCTION public.guard_content_scope();

CREATE TABLE public.competitor_snapshots (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), org_id uuid NOT NULL, workspace_id uuid NOT NULL, competitor_id uuid NOT NULL, site_url text NOT NULL CHECK(length(site_url) BETWEEN 4 AND 500), pages jsonb NOT NULL DEFAULT '[]'::jsonb CHECK(jsonb_typeof(pages)='array' AND length(pages::text)<=120000), created_by uuid NOT NULL DEFAULT auth.uid(), created_at timestamptz NOT NULL DEFAULT now(), FOREIGN KEY(competitor_id,org_id,workspace_id) REFERENCES public.competitors(id,org_id,workspace_id));
GRANT SELECT, INSERT ON public.competitor_snapshots TO authenticated; GRANT ALL ON public.competitor_snapshots TO service_role;
ALTER TABLE public.competitor_snapshots ENABLE ROW LEVEL SECURITY;
CREATE POLICY competitor_snapshots_read ON public.competitor_snapshots FOR SELECT TO authenticated USING(public.has_workspace_role(workspace_id,'viewer'));
CREATE POLICY competitor_snapshots_create ON public.competitor_snapshots FOR INSERT TO authenticated WITH CHECK(public.has_workspace_role(workspace_id,'member') AND created_by=auth.uid());
CREATE INDEX competitor_snapshots_idx ON public.competitor_snapshots(competitor_id, created_at DESC);

CREATE TABLE public.competitor_observations (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), org_id uuid NOT NULL, workspace_id uuid NOT NULL, competitor_id uuid NOT NULL, snapshot_id uuid REFERENCES public.competitor_snapshots(id), kind text NOT NULL CHECK(kind IN ('verified_fact','interpretation')), category text NOT NULL CHECK(category IN ('positioning','offering','messaging','content','seo','change','opportunity','other')), statement text NOT NULL CHECK(length(trim(statement)) BETWEEN 1 AND 1000), source_url text NOT NULL DEFAULT '' CHECK(length(source_url)<=500), observed_at timestamptz NOT NULL DEFAULT now(), review_status text NOT NULL DEFAULT 'needs_review' CHECK(review_status IN ('needs_review','relevant','irrelevant')), goal_id uuid REFERENCES public.growth_goals(id), created_by uuid NOT NULL DEFAULT auth.uid(), created_at timestamptz NOT NULL DEFAULT now(), FOREIGN KEY(competitor_id,org_id,workspace_id) REFERENCES public.competitors(id,org_id,workspace_id), CHECK(kind='interpretation' OR source_url<>''));
GRANT SELECT, INSERT ON public.competitor_observations TO authenticated; GRANT UPDATE(review_status, goal_id) ON public.competitor_observations TO authenticated; GRANT ALL ON public.competitor_observations TO service_role;
ALTER TABLE public.competitor_observations ENABLE ROW LEVEL SECURITY;
CREATE POLICY competitor_obs_read ON public.competitor_observations FOR SELECT TO authenticated USING(public.has_workspace_role(workspace_id,'viewer'));
CREATE POLICY competitor_obs_create ON public.competitor_observations FOR INSERT TO authenticated WITH CHECK(public.has_workspace_role(workspace_id,'member') AND created_by=auth.uid());
CREATE POLICY competitor_obs_update ON public.competitor_observations FOR UPDATE TO authenticated USING(public.has_workspace_role(workspace_id,'member')) WITH CHECK(public.has_workspace_role(workspace_id,'member'));
CREATE INDEX competitor_obs_idx ON public.competitor_observations(competitor_id, observed_at DESC);
CREATE OR REPLACE FUNCTION public.guard_competitor_obs() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
BEGIN
  IF NEW.goal_id IS NOT NULL AND NOT EXISTS (SELECT 1 FROM public.growth_goals g WHERE g.id=NEW.goal_id AND g.workspace_id=NEW.workspace_id) THEN RAISE EXCEPTION 'goal outside workspace'; END IF;
  IF NEW.snapshot_id IS NOT NULL AND NOT EXISTS (SELECT 1 FROM public.competitor_snapshots s WHERE s.id=NEW.snapshot_id AND s.competitor_id=NEW.competitor_id) THEN RAISE EXCEPTION 'snapshot mismatch'; END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER competitor_obs_guard BEFORE INSERT OR UPDATE ON public.competitor_observations FOR EACH ROW EXECUTE FUNCTION public.guard_competitor_obs();
CREATE TRIGGER competitor_obs_scope BEFORE INSERT OR UPDATE ON public.competitor_observations FOR EACH ROW EXECUTE FUNCTION public.guard_content_scope();
CREATE TRIGGER competitor_snap_scope BEFORE INSERT OR UPDATE ON public.competitor_snapshots FOR EACH ROW EXECUTE FUNCTION public.guard_content_scope();