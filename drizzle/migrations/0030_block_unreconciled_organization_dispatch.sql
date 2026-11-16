CREATE FUNCTION public.guard_unreconciled_coordination() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
BEGIN
 IF EXISTS(SELECT 1 FROM public.ai_call_receipts r JOIN public.ai_credit_reservations v ON v.run_id=r.run_id WHERE r.org_id=NEW.org_id AND v.status='reserved' AND r.state IN ('dispatching','unknown','delivered')) THEN RAISE EXCEPTION 'Unreconciled AI work requires investigation before another coordinated analysis.'; END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER coordination_unreconciled_guard BEFORE INSERT ON public.coordinated_analyses FOR EACH ROW EXECUTE FUNCTION public.guard_unreconciled_coordination();