-- PROPOSED migration 0092: campaign proposal decisions are enforced by the database, not only hidden buttons.
-- A campaign proposal is an execution note of the new kind 'proposal' (one per campaign)
-- whose body is JSON {v,status,text,decidedBy,decidedAt,note}. Rules (every INSERT/UPDATE path):
--  * a new proposal is always a draft;
--  * a proposal note can never be turned into another note type or vice versa;
--  * only a business admin (has_workspace_role 'admin') may move a draft to approved/rejected, must record
--    themselves as decider, and may not change the text in the same write;
--  * a decided proposal can only go back to draft (modification), never be re-decided or rewritten in place.
-- Idempotent.
ALTER TABLE public.execution_notes DROP CONSTRAINT IF EXISTS execution_notes_kind_check;
ALTER TABLE public.execution_notes ADD CONSTRAINT execution_notes_kind_check
  CHECK (kind IN ('comment','milestone','asset','member','dependency','approval','proposal'));
CREATE UNIQUE INDEX IF NOT EXISTS execution_proposal_unique ON public.execution_notes(entity_id) WHERE kind = 'proposal';
CREATE OR REPLACE FUNCTION public.guard_campaign_proposal() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  is_new boolean := NEW.kind = 'proposal';
  is_old boolean := TG_OP = 'UPDATE' AND OLD.kind = 'proposal';
  nb jsonb; ob jsonb; ns text; os text;
BEGIN
  IF NOT is_new AND NOT is_old THEN RETURN NEW; END IF;
  IF is_new IS DISTINCT FROM is_old AND TG_OP = 'UPDATE' THEN RAISE EXCEPTION 'proposal_type_locked'; END IF;
  IF NEW.entity_type <> 'campaigns' THEN RAISE EXCEPTION 'proposal_campaign_only'; END IF;
  BEGIN nb := NEW.body::jsonb; EXCEPTION WHEN others THEN RAISE EXCEPTION 'proposal_malformed'; END;
  ns := nb->>'status';
  IF ns IS NULL OR ns NOT IN ('draft','approved','rejected') THEN RAISE EXCEPTION 'proposal_malformed'; END IF;
  IF TG_OP = 'INSERT' THEN
    IF ns <> 'draft' THEN RAISE EXCEPTION 'proposal_must_start_draft'; END IF;
    RETURN NEW;
  END IF;
  ob := OLD.body::jsonb; os := ob->>'status';
  IF ns = 'draft' THEN RETURN NEW; END IF;                     -- saving / modifying
  IF os IS DISTINCT FROM 'draft' THEN RAISE EXCEPTION 'proposal_already_decided'; END IF;
  IF NOT public.has_workspace_role(NEW.workspace_id, 'admin') THEN RAISE EXCEPTION 'proposal_decision_denied'; END IF;
  IF (nb->>'decidedBy') IS DISTINCT FROM auth.uid()::text THEN RAISE EXCEPTION 'proposal_decider_mismatch'; END IF;
  IF (nb->>'text') IS DISTINCT FROM (ob->>'text') THEN RAISE EXCEPTION 'proposal_text_changed_on_decision'; END IF;
  PERFORM public.log_audit(NEW.org_id, 'campaign_proposal.' || ns, 'campaign', NEW.entity_id::text,
    jsonb_build_object('note', NEW.id, 'workspace', NEW.workspace_id));
  RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION public.guard_campaign_proposal() FROM PUBLIC, anon, authenticated;
DROP TRIGGER IF EXISTS guard_campaign_proposal ON public.execution_notes;
CREATE TRIGGER guard_campaign_proposal BEFORE INSERT OR UPDATE ON public.execution_notes
  FOR EACH ROW EXECUTE FUNCTION public.guard_campaign_proposal();
