CREATE TABLE public.crm_contacts (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), org_id uuid NOT NULL REFERENCES public.organizations(id), workspace_id uuid NOT NULL REFERENCES public.workspaces(id), name text NOT NULL CHECK(length(trim(name)) BETWEEN 1 AND 200), company text NOT NULL DEFAULT '' CHECK(length(company)<=200), email text NOT NULL DEFAULT '' CHECK(length(email)<=320), phone text NOT NULL DEFAULT '' CHECK(length(phone)<=60), source text NOT NULL DEFAULT '' CHECK(length(source)<=80), notes text NOT NULL DEFAULT '' CHECK(length(notes)<=4000), status text NOT NULL DEFAULT 'active' CHECK(status IN ('active','archived')), created_by uuid NOT NULL DEFAULT auth.uid(), created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now());
GRANT SELECT, INSERT, UPDATE ON public.crm_contacts TO authenticated; GRANT ALL ON public.crm_contacts TO service_role;
ALTER TABLE public.crm_contacts ENABLE ROW LEVEL SECURITY;
CREATE TABLE public.crm_deals (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), org_id uuid NOT NULL REFERENCES public.organizations(id), workspace_id uuid NOT NULL REFERENCES public.workspaces(id), title text NOT NULL CHECK(length(trim(title)) BETWEEN 1 AND 200), contact_id uuid REFERENCES public.crm_contacts(id), goal_id uuid REFERENCES public.growth_goals(id), stage text NOT NULL DEFAULT 'lead' CHECK(stage IN ('lead','qualified','proposal','negotiation','won','lost')), value numeric NOT NULL DEFAULT 0 CHECK(value>=0), currency text NOT NULL DEFAULT 'EUR' CHECK(currency ~ '^[A-Z]{3}$'), expected_close date, lost_reason text NOT NULL DEFAULT '' CHECK(length(lost_reason)<=500), closed_at timestamptz, created_by uuid NOT NULL DEFAULT auth.uid(), created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now());
GRANT SELECT, INSERT, UPDATE ON public.crm_deals TO authenticated; GRANT ALL ON public.crm_deals TO service_role;
ALTER TABLE public.crm_deals ENABLE ROW LEVEL SECURITY;
CREATE INDEX crm_contacts_ws_idx ON public.crm_contacts(workspace_id, created_at);
CREATE INDEX crm_deals_ws_idx ON public.crm_deals(workspace_id, stage);
CREATE OR REPLACE FUNCTION public.guard_crm_deal_links() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
BEGIN
  IF NEW.contact_id IS NOT NULL AND NOT EXISTS (SELECT 1 FROM public.crm_contacts c WHERE c.id=NEW.contact_id AND c.workspace_id=NEW.workspace_id) THEN RAISE EXCEPTION 'contact outside workspace'; END IF;
  IF NEW.goal_id IS NOT NULL AND NOT EXISTS (SELECT 1 FROM public.growth_goals g WHERE g.id=NEW.goal_id AND g.workspace_id=NEW.workspace_id) THEN RAISE EXCEPTION 'goal outside workspace'; END IF;
  NEW.updated_at := now();
  IF NEW.stage IN ('won','lost') AND (TG_OP='INSERT' OR OLD.stage NOT IN ('won','lost')) THEN NEW.closed_at := now(); ELSIF NEW.stage NOT IN ('won','lost') THEN NEW.closed_at := NULL; END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER crm_deal_links BEFORE INSERT OR UPDATE ON public.crm_deals FOR EACH ROW EXECUTE FUNCTION public.guard_crm_deal_links();
DO $$ DECLARE t text; BEGIN FOREACH t IN ARRAY ARRAY['crm_contacts','crm_deals'] LOOP
 EXECUTE format('CREATE POLICY crm_read ON public.%I FOR SELECT TO authenticated USING(public.has_workspace_role(workspace_id,''viewer''))',t);
 EXECUTE format('CREATE POLICY crm_create ON public.%I FOR INSERT TO authenticated WITH CHECK(public.has_workspace_role(workspace_id,''member'') AND created_by=auth.uid())',t);
 EXECUTE format('CREATE POLICY crm_update ON public.%I FOR UPDATE TO authenticated USING(public.has_workspace_role(workspace_id,''member'')) WITH CHECK(public.has_workspace_role(workspace_id,''member''))',t);
 EXECUTE format('CREATE TRIGGER crm_scope_guard BEFORE INSERT OR UPDATE ON public.%I FOR EACH ROW EXECUTE FUNCTION public.guard_content_scope()',t);
END LOOP; END $$;