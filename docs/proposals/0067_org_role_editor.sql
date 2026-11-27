-- PROPOSED migration 0067 — business editor role. Staging only until separately approved.
-- Adds 'editor' between admin and member. Must be committed on its own before 0068, because PostgreSQL does not
-- allow a new enum value to be used in the transaction that adds it. role_rank compares as text for the same reason.
-- Ranks: owner 5, admin 4, editor 3, member 2, viewer 1. Member stays 2, so existing ">= member" checks (including the
-- literal ">= 2" in execution_user_allowed) keep their meaning and editors pass every member check.
ALTER TYPE public.org_role ADD VALUE IF NOT EXISTS 'editor' BEFORE 'member';
CREATE OR REPLACE FUNCTION public.role_rank(_r public.org_role) RETURNS int LANGUAGE sql IMMUTABLE SET search_path = public AS $$
  SELECT CASE _r::text WHEN 'owner' THEN 5 WHEN 'admin' THEN 4 WHEN 'editor' THEN 3 WHEN 'member' THEN 2 ELSE 1 END
$$;
