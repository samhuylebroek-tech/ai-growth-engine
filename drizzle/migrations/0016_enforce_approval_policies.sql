CREATE OR REPLACE FUNCTION public.guard_approval_proposal() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
BEGIN
  IF EXISTS(SELECT 1 FROM public.policies p WHERE p.org_id=NEW.org_id AND p.capability_key=NEW.capability_key AND p.mode='blocked') THEN
    RAISE EXCEPTION 'This capability is blocked by organization policy';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER approval_policy_guard BEFORE INSERT ON public.approvals FOR EACH ROW EXECUTE FUNCTION public.guard_approval_proposal();

CREATE OR REPLACE FUNCTION public.decide_approval(_id uuid,_approve boolean,_note text) RETURNS public.approval_status LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE a public.approvals; ns public.approval_status;
BEGIN
  SELECT * INTO a FROM public.approvals WHERE id=_id FOR UPDATE;
  IF a.id IS NULL OR NOT public.has_workspace_role(a.workspace_id,'admin') THEN RAISE EXCEPTION 'forbidden'; END IF;
  IF a.status<>'pending' THEN RAISE EXCEPTION 'approval is not pending'; END IF;
  IF _approve AND EXISTS(SELECT 1 FROM public.policies p WHERE p.org_id=a.org_id AND p.capability_key=a.capability_key AND p.mode='blocked') THEN RAISE EXCEPTION 'This capability is blocked by organization policy'; END IF;
  ns:=CASE WHEN _approve THEN 'approved'::public.approval_status ELSE 'rejected'::public.approval_status END;
  UPDATE public.approvals SET status=ns,decided_by=auth.uid(),decided_at=now(),decision_note=left(_note,1000) WHERE id=_id;
  INSERT INTO public.audit_logs(org_id,actor_id,action,target_type,target_id,metadata) VALUES(a.org_id,auth.uid(),'approval.'||ns::text,'approval',_id::text,jsonb_build_object('capability',a.capability_key));
  RETURN ns;
END $$;
REVOKE ALL ON FUNCTION public.decide_approval(uuid,boolean,text) FROM public,anon;
GRANT EXECUTE ON FUNCTION public.decide_approval(uuid,boolean,text) TO authenticated;