CREATE TABLE public.ai_credit_reservations (
  run_id uuid PRIMARY KEY REFERENCES public.agent_runs(id) ON DELETE CASCADE,
  org_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  user_id uuid NOT NULL,
  reserved int NOT NULL CHECK (reserved BETWEEN 1 AND 1000),
  charged int CHECK (charged BETWEEN 0 AND 1000),
  status text NOT NULL DEFAULT 'reserved' CHECK (status IN ('reserved','settled','refunded')),
  created_at timestamptz NOT NULL DEFAULT now(),
  settled_at timestamptz
);
GRANT SELECT ON public.ai_credit_reservations TO authenticated;
GRANT ALL ON public.ai_credit_reservations TO service_role;
ALTER TABLE public.ai_credit_reservations ENABLE ROW LEVEL SECURITY;
CREATE POLICY "users read own credit reservations" ON public.ai_credit_reservations FOR SELECT TO authenticated USING (user_id = auth.uid() AND public.has_org_role(org_id,'viewer'));

CREATE OR REPLACE FUNCTION public.reserve_ai_credits(_run uuid, _amount int) RETURNS int LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE r public.agent_runs%ROWTYPE; existing public.ai_credit_reservations%ROWTYPE; sub public.subscriptions%ROWTYPE; bal int;
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'not authenticated'; END IF;
  IF _amount <= 0 OR _amount > 1000 THEN RAISE EXCEPTION 'invalid amount'; END IF;
  SELECT * INTO r FROM public.agent_runs WHERE id = _run;
  IF r.id IS NULL OR r.user_id <> auth.uid() OR NOT public.has_workspace_role(r.workspace_id,'member') THEN RAISE EXCEPTION 'forbidden'; END IF;
  PERFORM 1 FROM public.organizations WHERE id = r.org_id FOR UPDATE;
  SELECT * INTO existing FROM public.ai_credit_reservations WHERE run_id = _run FOR UPDATE;
  IF existing.run_id IS NOT NULL THEN
    IF existing.user_id <> auth.uid() THEN RAISE EXCEPTION 'forbidden'; END IF;
    IF existing.status <> 'reserved' THEN RAISE EXCEPTION 'credit reservation is closed'; END IF;
    RETURN existing.reserved;
  END IF;
  SELECT * INTO sub FROM public.subscriptions WHERE org_id = r.org_id;
  IF sub.org_id IS NULL OR sub.status NOT IN ('active','trialing') THEN RAISE EXCEPTION 'no active subscription'; END IF;
  IF sub.status = 'trialing' AND (sub.trial_ends_at IS NULL OR sub.trial_ends_at <= now()) THEN RAISE EXCEPTION 'trial expired'; END IF;
  bal := public.credit_balance(r.org_id);
  IF bal < _amount THEN RAISE EXCEPTION 'insufficient credits'; END IF;
  INSERT INTO public.credit_ledger(org_id,delta,reason,ref,created_by) VALUES(r.org_id,-_amount,'usage',left('run:'||_run::text||':reserve',100),auth.uid());
  INSERT INTO public.ai_credit_reservations(run_id,org_id,user_id,reserved) VALUES(_run,r.org_id,auth.uid(),_amount);
  RETURN _amount;
END $$;

CREATE OR REPLACE FUNCTION public.settle_ai_credits(_run uuid, _actual int, _provider text, _model text, _input_tokens int, _output_tokens int, _cost_estimate_eur numeric) RETURNS int LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE res public.ai_credit_reservations%ROWTYPE; oid uuid; bal int; extra int; charged int;
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'not authenticated'; END IF;
  IF _actual < 0 OR _actual > 1000 OR _input_tokens < 0 OR _output_tokens < 0 OR _cost_estimate_eur < 0 THEN RAISE EXCEPTION 'invalid usage'; END IF;
  IF length(_provider) NOT BETWEEN 1 AND 100 OR length(_model) NOT BETWEEN 1 AND 150 THEN RAISE EXCEPTION 'invalid provider usage'; END IF;
  SELECT org_id INTO oid FROM public.ai_credit_reservations WHERE run_id = _run;
  IF oid IS NULL THEN RAISE EXCEPTION 'credit reservation not found'; END IF;
  PERFORM 1 FROM public.organizations WHERE id = oid FOR UPDATE;
  SELECT * INTO res FROM public.ai_credit_reservations WHERE run_id = _run FOR UPDATE;
  IF res.user_id <> auth.uid() THEN RAISE EXCEPTION 'forbidden'; END IF;
  IF res.status = 'settled' THEN RETURN res.charged; END IF;
  IF res.status <> 'reserved' THEN RAISE EXCEPTION 'credit reservation is closed'; END IF;
  charged := _actual;
  IF charged >= res.reserved THEN
    extra := charged - res.reserved;
    bal := GREATEST(public.credit_balance(oid),0);
    IF bal < extra THEN extra := bal; charged := res.reserved + extra; END IF;
    IF extra > 0 THEN INSERT INTO public.credit_ledger(org_id,delta,reason,ref,created_by) VALUES(oid,-extra,'usage',left('run:'||_run::text||':settle',100),auth.uid()); END IF;
  ELSE
    INSERT INTO public.credit_ledger(org_id,delta,reason,ref,created_by) VALUES(oid,res.reserved-charged,'refund',left('run:'||_run::text||':settle',100),auth.uid());
  END IF;
  INSERT INTO public.ai_usage_events(org_id,run_id,user_id,provider,model,input_tokens,output_tokens,cost_estimate_eur,credits_charged) VALUES(oid,_run,auth.uid(),_provider,_model,_input_tokens,_output_tokens,_cost_estimate_eur,charged);
  UPDATE public.ai_credit_reservations SET status='settled',charged=charged,settled_at=now() WHERE run_id=_run;
  RETURN charged;
END $$;

CREATE OR REPLACE FUNCTION public.refund_ai_credits(_run uuid) RETURNS int LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE res public.ai_credit_reservations%ROWTYPE; oid uuid;
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'not authenticated'; END IF;
  SELECT org_id INTO oid FROM public.ai_credit_reservations WHERE run_id = _run;
  IF oid IS NULL THEN RAISE EXCEPTION 'credit reservation not found'; END IF;
  PERFORM 1 FROM public.organizations WHERE id = oid FOR UPDATE;
  SELECT * INTO res FROM public.ai_credit_reservations WHERE run_id = _run FOR UPDATE;
  IF res.user_id <> auth.uid() THEN RAISE EXCEPTION 'forbidden'; END IF;
  IF res.status = 'refunded' THEN RETURN 0; END IF;
  IF res.status <> 'reserved' THEN RAISE EXCEPTION 'settled credits cannot be refunded through this function'; END IF;
  INSERT INTO public.credit_ledger(org_id,delta,reason,ref,created_by) VALUES(oid,res.reserved,'refund',left('run:'||_run::text||':failed',100),auth.uid());
  UPDATE public.ai_credit_reservations SET status='refunded',charged=0,settled_at=now() WHERE run_id=_run;
  RETURN 0;
END $$;

REVOKE ALL ON FUNCTION public.reserve_ai_credits(uuid,int), public.settle_ai_credits(uuid,int,text,text,int,int,numeric), public.refund_ai_credits(uuid) FROM public,anon;
GRANT EXECUTE ON FUNCTION public.reserve_ai_credits(uuid,int), public.settle_ai_credits(uuid,int,text,text,int,int,numeric), public.refund_ai_credits(uuid) TO authenticated;
REVOKE INSERT ON public.ai_usage_events FROM authenticated;

CREATE OR REPLACE FUNCTION public.create_invitation(_org uuid, _email text, _role public.org_role) RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE normalized text := lower(trim(_email)); lim int; seats int; pending int; tok uuid; iid uuid;
BEGIN
  IF auth.uid() IS NULL OR NOT public.has_org_role(_org,'admin') THEN RAISE EXCEPTION 'forbidden'; END IF;
  IF _role IS NULL OR _role::text NOT IN ('admin','member','viewer') THEN RAISE EXCEPTION 'invalid role'; END IF;
  IF length(normalized) > 254 OR normalized !~* '^[^@[:space:]]+@[^@[:space:]]+\.[^@[:space:]]+$' THEN RAISE EXCEPTION 'invalid email'; END IF;
  PERFORM 1 FROM public.organizations WHERE id = _org FOR UPDATE;
  IF EXISTS(SELECT 1 FROM auth.users u JOIN public.organization_members m ON m.user_id=u.id AND m.org_id=_org WHERE lower(u.email)=normalized) THEN RAISE EXCEPTION 'This person is already a member'; END IF;
  IF EXISTS(SELECT 1 FROM public.invitations WHERE org_id=_org AND lower(email)=normalized AND accepted_at IS NULL AND expires_at>now()) THEN RAISE EXCEPTION 'A pending invitation already exists'; END IF;
  SELECT e.limit_value INTO lim FROM public.subscriptions s JOIN public.plan_entitlements e ON e.plan_key=s.plan_key WHERE s.org_id=_org AND s.status IN ('active','trialing') AND e.feature_key='seats';
  IF NOT FOUND THEN RAISE EXCEPTION 'Seat entitlement not configured'; END IF;
  SELECT count(*) INTO seats FROM public.organization_members WHERE org_id=_org;
  SELECT count(*) INTO pending FROM public.invitations WHERE org_id=_org AND accepted_at IS NULL AND expires_at>now();
  IF lim IS NOT NULL AND seats+pending >= lim THEN RAISE EXCEPTION 'Your team seat limit has been reached'; END IF;
  INSERT INTO public.invitations(org_id,email,role,invited_by) VALUES(_org,normalized,_role,auth.uid()) RETURNING token,id INTO tok,iid;
  INSERT INTO public.audit_logs(org_id,actor_id,action,target_type,target_id,metadata) VALUES(_org,auth.uid(),'member.invited','invitation',iid::text,jsonb_build_object('role',_role));
  RETURN tok;
END $$;

CREATE OR REPLACE FUNCTION public.accept_invitation(_token uuid) RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE inv public.invitations; em text; confirmed timestamptz; lim int; seats int; already boolean;
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'not authenticated'; END IF;
  SELECT email,email_confirmed_at INTO em,confirmed FROM auth.users WHERE id=auth.uid();
  IF confirmed IS NULL THEN RAISE EXCEPTION 'Confirm your email before accepting this invitation'; END IF;
  SELECT * INTO inv FROM public.invitations WHERE token=_token FOR UPDATE;
  IF inv.id IS NULL OR inv.accepted_at IS NOT NULL OR inv.expires_at<=now() THEN RAISE EXCEPTION 'invitation invalid or expired'; END IF;
  IF lower(inv.email)<>lower(em) THEN RAISE EXCEPTION 'invitation is for a different email'; END IF;
  PERFORM 1 FROM public.organizations WHERE id=inv.org_id FOR UPDATE;
  SELECT EXISTS(SELECT 1 FROM public.organization_members WHERE org_id=inv.org_id AND user_id=auth.uid()) INTO already;
  IF NOT already THEN
    SELECT e.limit_value INTO lim FROM public.subscriptions s JOIN public.plan_entitlements e ON e.plan_key=s.plan_key WHERE s.org_id=inv.org_id AND s.status IN ('active','trialing') AND e.feature_key='seats';
    IF NOT FOUND THEN RAISE EXCEPTION 'Seat entitlement not configured'; END IF;
    SELECT count(*) INTO seats FROM public.organization_members WHERE org_id=inv.org_id;
    IF lim IS NOT NULL AND seats>=lim THEN RAISE EXCEPTION 'Your team seat limit has been reached'; END IF;
    INSERT INTO public.organization_members(org_id,user_id,role) VALUES(inv.org_id,auth.uid(),inv.role);
  END IF;
  UPDATE public.invitations SET accepted_at=now() WHERE id=inv.id;
  INSERT INTO public.audit_logs(org_id,actor_id,action,target_type,target_id,metadata) VALUES(inv.org_id,auth.uid(),'member.joined','invitation',inv.id::text,jsonb_build_object('role',inv.role,'existing_member',already));
  RETURN inv.org_id;
END $$;

REVOKE ALL ON FUNCTION public.create_invitation(uuid,text,public.org_role), public.accept_invitation(uuid) FROM public,anon;
GRANT EXECUTE ON FUNCTION public.create_invitation(uuid,text,public.org_role), public.accept_invitation(uuid) TO authenticated;
REVOKE INSERT ON public.invitations FROM authenticated;