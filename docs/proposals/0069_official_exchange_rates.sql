-- PROPOSED migration 0069 — official daily exchange rates. Staging only until separately approved; requires 0068.
-- The organization chose the European Central Bank's daily euro reference rates as its rate source. Rates are fetched
-- by the server (never typed or sent by a browser), stored once per organization/currency/date, and stay permanent.
-- Writes require the server-only proof, so a browser cannot present its own numbers as official.
ALTER TABLE public.exchange_rates ADD COLUMN IF NOT EXISTS kind text NOT NULL DEFAULT 'manual';
ALTER TABLE public.exchange_rates DROP CONSTRAINT IF EXISTS exchange_rates_kind_check;
ALTER TABLE public.exchange_rates ADD CONSTRAINT exchange_rates_kind_check CHECK (kind IN ('manual', 'official'));
CREATE UNIQUE INDEX IF NOT EXISTS exchange_rates_official_once
  ON public.exchange_rates(org_id, base_currency, quote_currency, rate_date) WHERE kind = 'official';

CREATE OR REPLACE FUNCTION public.import_official_rates_verified(_org uuid, _date date, _rates jsonb, _proof text)
RETURNS int LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE r jsonb; cur text; val numeric; n int := 0; added int;
BEGIN
  PERFORM public.verify_ai_accounting(_proof);
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'Authentication required'; END IF;
  IF NOT public.is_org_member(_org) THEN RAISE EXCEPTION 'Not a member of this organization'; END IF;
  IF _date IS NULL OR _date > current_date OR _date < current_date - 14 THEN RAISE EXCEPTION 'Official rates must be from the last 14 days'; END IF;
  IF jsonb_typeof(_rates) <> 'array' OR jsonb_array_length(_rates) NOT BETWEEN 1 AND 60 THEN RAISE EXCEPTION 'Expected between 1 and 60 rates'; END IF;
  FOR r IN SELECT value FROM jsonb_array_elements(_rates) LOOP
    cur := r->>'currency';
    IF cur IS NULL OR cur !~ '^[A-Z]{3}$' OR cur = 'EUR' THEN RAISE EXCEPTION 'Invalid currency in official rates'; END IF;
    BEGIN val := (r->>'rate')::numeric; EXCEPTION WHEN others THEN RAISE EXCEPTION 'Invalid rate for %', cur; END;
    IF val IS NULL OR val <= 0 OR val >= 1000000 THEN RAISE EXCEPTION 'Invalid rate for %', cur; END IF;
    INSERT INTO public.exchange_rates(org_id, base_currency, quote_currency, rate, rate_date, source, kind, created_by)
    VALUES (_org, 'EUR', cur, round(val, 8), _date, 'ECB euro foreign exchange reference rate', 'official', auth.uid())
    ON CONFLICT (org_id, base_currency, quote_currency, rate_date) WHERE kind = 'official' DO NOTHING;
    GET DIAGNOSTICS added = ROW_COUNT; n := n + added;
  END LOOP;
  IF n > 0 THEN
    PERFORM public.log_audit(_org, 'finance.official_rates_imported', 'exchange_rate', _date::text, jsonb_build_object('date', _date, 'added', n, 'source', 'ECB'));
  END IF;
  RETURN n;
END $$;
REVOKE ALL ON FUNCTION public.import_official_rates_verified(uuid, date, jsonb, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.import_official_rates_verified(uuid, date, jsonb, text) TO authenticated;
