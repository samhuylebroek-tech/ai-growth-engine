// Official exchange rates: the server fetches the ECB daily reference rates and stores them through a proof-checked
// SQL function as the signed-in user, so a browser can never present its own numbers as official. Idempotent:
// a publication already stored for the organization adds nothing.
import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import type { SupabaseClient } from "@supabase/supabase-js";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import type { PendingDatabase } from "@/lib/pending-schema";
import { fetchEcbDaily } from "@/lib/org/ecb";

const ECB_ERRORS = {
  unreachable: "The European Central Bank could not be reached. No rates were changed.",
  too_large: "The ECB response was larger than expected. No rates were changed.",
  unreadable: "The ECB response could not be read. No rates were changed.",
  future_date: "The ECB response carried a publication date in the future. No rates were changed.",
} as const;

export type OfficialRatesResult = { ok: true; date: string; added: number; currencies: number } | { ok: false; error: string };

export const syncOfficialRates = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => z.object({ orgId: z.string().uuid() }).parse(d))
  .handler(async ({ data, context }): Promise<OfficialRatesResult> => {
    const proof = process.env["AI_ACCOUNTING_SECRET"];
    if (!proof) return { ok: false, error: "Server verification is not configured." };
    const got = await fetchEcbDaily(fetch, new Date().toISOString().slice(0, 10));
    if (!got.ok) return { ok: false, error: ECB_ERRORS[got.reason] };
    const parsed = got.daily;
    const sb = context.supabase as unknown as SupabaseClient<PendingDatabase>;
    const r = await sb.rpc("import_official_rates_verified", { _org: data.orgId, _date: parsed.date, _rates: parsed.rates, _proof: proof });
    if (r.error) return { ok: false, error: r.error.message.slice(0, 200) };
    return { ok: true, date: parsed.date, added: Number(r.data ?? 0), currencies: parsed.rates.length };
  });
