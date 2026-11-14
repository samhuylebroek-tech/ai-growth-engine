CREATE UNIQUE INDEX credit_monthly_grant_once ON public.credit_ledger(org_id,ref) WHERE reason='plan_grant' AND ref LIKE 'monthly:%';
CREATE OR REPLACE FUNCTION public.ensure_monthly_credit_grant(_org uuid) RETURNS int LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$ DECLARE sub public.subscriptions%ROWTYPE; credits int; period timestamptz := date_trunc('month',now()); refkey text; added int; BEGIN
IF NOT public.has_org_role(_org,'member') THEN RAISE EXCEPTION 'forbidden'; END IF;
PERFORM 1 FROM public.organizations WHERE id=_org FOR UPDATE;
SELECT * INTO sub FROM public.subscriptions WHERE org_id=_org;
IF sub.org_id IS NULL OR sub.status <> 'active' OR sub.plan_key='trial' THEN RETURN 0; END IF;
SELECT monthly_credits INTO credits FROM public.plans WHERE key=sub.plan_key;
IF credits IS NULL OR credits<=0 THEN RETURN 0; END IF;
refkey := 'monthly:' || to_char(period AT TIME ZONE 'UTC','YYYY-MM');
INSERT INTO public.credit_ledger(org_id,delta,reason,ref,created_by) VALUES(_org,credits,'plan_grant',refkey,auth.uid()) ON CONFLICT DO NOTHING;
GET DIAGNOSTICS added=ROW_COUNT;
IF added=1 THEN UPDATE public.subscriptions SET current_period_start=period WHERE org_id=_org; INSERT INTO public.audit_logs(org_id,actor_id,action,target_type,target_id,metadata) VALUES(_org,auth.uid(),'credits.monthly_granted','organization',_org::text,jsonb_build_object('period',refkey,'credits',credits)); END IF;
RETURN CASE WHEN added=1 THEN credits ELSE 0 END;
END $$;
REVOKE ALL ON FUNCTION public.ensure_monthly_credit_grant(uuid) FROM public,anon;
GRANT EXECUTE ON FUNCTION public.ensure_monthly_credit_grant(uuid) TO authenticated;