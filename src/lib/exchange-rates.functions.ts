// Official exchange rates: the server fetches the ECB daily reference rates and stores them through a proof-checked
// SQL function as the signed-in user, so a browser can never present its own numbers as official. Idempotent:
// a publication already stored for the organization adds nothing.
import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import type { SupabaseClient } from "@supabase/supabase-js";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import type { PendingDatabase } from "@/lib/pending-schema";
import { ECB_DAILY_URL, ECB_MAX_BYTES, parseEcbDaily } from "@/lib/org/ecb";

export type OfficialRatesResult = { ok: true; date: string; added: number; currencies: number } | { ok: false; error: string };

export const syncOfficialRates = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => z.object({ orgId: z.string().uuid() }).parse(d))
  .handler(async ({ data, context }): Promise<OfficialRatesResult> => {
    const proof = process.env["AI_ACCOUNTING_SECRET"];
    if (!proof) return { ok: false, error: "Server verification is not configured." };
    let xml: string;
    try {
      const res = await fetch(ECB_DAILY_URL, { headers: { accept: "application/xml" }, signal: AbortSignal.timeout(8000), redirect: "error" });
      if (!res.ok) return { ok: false, error: "The European Central Bank could not be reached. No rates were changed." };
      const declared = Number(res.headers.get("content-length") ?? "0");
      if (declared > ECB_MAX_BYTES) return { ok: false, error: "The ECB response was larger than expected. No rates were changed." };
      xml = await res.text();
    } catch {
      return { ok: false, error: "The European Central Bank could not be reached. No rates were changed." };
    }
    let parsed;
    try { parsed = parseEcbDaily(xml); } catch { return { ok: false, error: "The ECB response could not be read. No rates were changed." }; }
    const sb = context.supabase as unknown as SupabaseClient<PendingDatabase>;
    const r = await sb.rpc("import_official_rates_verified", { _org: data.orgId, _date: parsed.date, _rates: parsed.rates, _proof: proof });
    if (r.error) return { ok: false, error: r.error.message.slice(0, 200) };
    return { ok: true, date: parsed.date, added: Number(r.data ?? 0), currencies: parsed.rates.length };
  });
