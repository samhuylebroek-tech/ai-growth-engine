REVOKE ALL ON public.competitor_observations FROM authenticated, anon;
REVOKE ALL ON public.competitor_snapshots FROM authenticated, anon;
REVOKE ALL ON public.competitors FROM anon;
REVOKE DELETE, TRUNCATE ON public.competitors FROM authenticated;
GRANT SELECT, INSERT ON public.competitor_observations TO authenticated;
GRANT UPDATE(review_status, goal_id) ON public.competitor_observations TO authenticated;
GRANT SELECT, INSERT ON public.competitor_snapshots TO authenticated;