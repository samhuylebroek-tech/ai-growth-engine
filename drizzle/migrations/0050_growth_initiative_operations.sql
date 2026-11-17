-- Add an operational layer without mutating the approved strategy snapshot.
ALTER TABLE public.growth_initiatives
  ADD CONSTRAINT growth_initiatives_scope_unique UNIQUE (id, org_id, workspace_id);

CREATE TABLE public.growth_initiative_operations (
  initiative_id uuid PRIMARY KEY,
  org_id uuid NOT NULL REFERENCES public.organizations(id),
  workspace_id uuid NOT NULL REFERENCES public.workspaces(id),
  owner_id uuid,
  due_date date,
  success_metric text NOT NULL DEFAULT '' CHECK (length(success_metric) <= 160),
  baseline_value numeric CHECK (baseline_value IS NULL OR baseline_value >= 0),
  target_value numeric CHECK (target_value IS NULL OR target_value >= 0),
  current_value numeric CHECK (current_value IS NULL OR current_value >= 0),
  blocker_note text NOT NULL DEFAULT '' CHECK (length(blocker_note) <= 1000),
  updated_by uuid NOT NULL DEFAULT auth.uid(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY (initiative_id, org_id, workspace_id)
    REFERENCES public.growth_initiatives(id, org_id, workspace_id) ON DELETE CASCADE,
  CHECK (target_value IS NULL OR baseline_value IS NULL OR target_value <> baseline_value)
);
CREATE INDEX growth_initiative_operations_owner_idx
  ON public.growth_initiative_operations(workspace_id, owner_id, due_date);
GRANT SELECT ON public.growth_initiative_operations TO authenticated;
GRANT ALL ON public.growth_initiative_operations TO service_role;
ALTER TABLE public.growth_initiative_operations ENABLE ROW LEVEL SECURITY;
CREATE POLICY growth_initiative_operations_read
  ON public.growth_initiative_operations FOR SELECT TO authenticated
  USING (public.has_workspace_role(workspace_id, 'viewer'));

-- All writes pass through this scoped RPC. The plan and initiative definition stay intact.
CREATE OR REPLACE FUNCTION public.update_growth_initiative_operations(_initiative uuid, _patch jsonb)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  i public.growth_initiatives%ROWTYPE;
  op public.growth_initiative_operations%ROWTYPE;
  owner_value uuid;
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'Authentication required'; END IF;
  IF jsonb_typeof(_patch) IS DISTINCT FROM 'object'
     OR (_patch - ARRAY['owner_id','due_date','success_metric','baseline_value','target_value','current_value','blocker_note','status']) <> '{}'::jsonb THEN
    RAISE EXCEPTION 'Invalid initiative update';
  END IF;
  SELECT * INTO i FROM public.growth_initiatives WHERE id = _initiative FOR UPDATE;
  IF NOT FOUND OR NOT public.has_workspace_role(i.workspace_id, 'member') THEN
    RAISE EXCEPTION 'Initiative unavailable';
  END IF;
  IF _patch ? 'owner_id' THEN
    owner_value := nullif(_patch->>'owner_id','')::uuid;
    IF NOT public.execution_user_allowed(i.workspace_id, owner_value) THEN
      RAISE EXCEPTION 'Owner needs workspace member access';
    END IF;
  END IF;
  INSERT INTO public.growth_initiative_operations(initiative_id,org_id,workspace_id)
  VALUES (i.id,i.org_id,i.workspace_id)
  ON CONFLICT (initiative_id) DO NOTHING;
  UPDATE public.growth_initiative_operations SET
    owner_id = CASE WHEN _patch ? 'owner_id' THEN owner_value ELSE owner_id END,
    due_date = CASE WHEN _patch ? 'due_date' THEN nullif(_patch->>'due_date','')::date ELSE due_date END,
    success_metric = CASE WHEN _patch ? 'success_metric' THEN left(coalesce(_patch->>'success_metric',''),160) ELSE success_metric END,
    baseline_value = CASE WHEN _patch ? 'baseline_value' THEN nullif(_patch->>'baseline_value','')::numeric ELSE baseline_value END,
    target_value = CASE WHEN _patch ? 'target_value' THEN nullif(_patch->>'target_value','')::numeric ELSE target_value END,
    current_value = CASE WHEN _patch ? 'current_value' THEN nullif(_patch->>'current_value','')::numeric ELSE current_value END,
    blocker_note = CASE WHEN _patch ? 'blocker_note' THEN left(coalesce(_patch->>'blocker_note',''),1000) ELSE blocker_note END,
    updated_by = auth.uid(), updated_at = now()
  WHERE initiative_id = i.id RETURNING * INTO op;
  IF _patch ? 'status' THEN
    IF _patch->>'status' NOT IN ('planned','in_progress','completed','paused','cancelled') THEN
      RAISE EXCEPTION 'Invalid initiative status';
    END IF;
    UPDATE public.growth_initiatives SET status = _patch->>'status' WHERE id = i.id;
  END IF;
  RETURN jsonb_build_object(
    'initiative_id', i.id, 'owner_id', op.owner_id, 'due_date', op.due_date,
    'success_metric', op.success_metric, 'baseline_value', op.baseline_value,
    'target_value', op.target_value, 'current_value', op.current_value,
    'blocker_note', op.blocker_note, 'status', coalesce(_patch->>'status',i.status),
    'updated_at', op.updated_at
  );
END;
$$;
REVOKE ALL ON FUNCTION public.update_growth_initiative_operations(uuid,jsonb) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.update_growth_initiative_operations(uuid,jsonb) TO authenticated;
