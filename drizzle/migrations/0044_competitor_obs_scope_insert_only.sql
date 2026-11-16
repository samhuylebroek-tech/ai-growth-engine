DROP TRIGGER competitor_obs_scope ON public.competitor_observations;
CREATE TRIGGER competitor_obs_scope BEFORE INSERT ON public.competitor_observations FOR EACH ROW EXECUTE FUNCTION public.guard_content_scope();
DROP TRIGGER competitor_snap_scope ON public.competitor_snapshots;
CREATE TRIGGER competitor_snap_scope BEFORE INSERT ON public.competitor_snapshots FOR EACH ROW EXECUTE FUNCTION public.guard_content_scope();