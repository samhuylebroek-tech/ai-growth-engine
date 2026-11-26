import { createServerFn } from "@tanstack/react-start";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import {
  formKeySchema,
  leadSubmitSchema,
  leadFormConfigSchema,
  publicLeadFormSchema,
  leadRuntimeAllowed,
  leadError,
  type LeadDatabase,
  type LeadError,
} from "@/lib/lead-contract";
import type { Json } from "@/integrations/supabase/types";

// No service role. Public form RPCs enforce all validation, limits, association and dedupe in SQL.
function publicClient(url: string, key: string) {
  return createClient<LeadDatabase>(url, key, {
    auth: { persistSession: false, autoRefreshToken: false },
    global: {
      fetch: (input, init) => {
        const headers = new Headers(init?.headers);
        if (key.startsWith("sb_") && headers.get("Authorization") === `Bearer ${key}`)
          headers.delete("Authorization");
        headers.set("apikey", key);
        return fetch(input, { ...init, headers });
      },
    },
  });
}
type Failure = { ok: false; error: LeadError };
const unavailable: Failure = { ok: false, error: "unavailable" };
export const getPublicLeadForm = createServerFn({ method: "GET" })
  .inputValidator((input: unknown) => z.object({ formKey: formKeySchema }).parse(input))
  .handler(async ({ data }) => {
    if (!leadRuntimeAllowed(process.env)) return unavailable;
    const url = process.env["SUPABASE_URL"],
      key = process.env["SUPABASE_PUBLISHABLE_KEY"];
    if (!url || !key) return unavailable;
    try {
      const result = await publicClient(url, key).rpc("public_lead_form", { _key: data.formKey });
      const parsed = publicLeadFormSchema.safeParse(result.data);
      if (result.error || !parsed.success) return unavailable;
      return { ok: true as const, form: parsed.data };
    } catch {
      return unavailable;
    }
  });
export const openLeadSession = createServerFn({ method: "POST" })
  .inputValidator((input: unknown) => z.object({ formKey: formKeySchema }).parse(input))
  .handler(async ({ data }) => {
    if (!leadRuntimeAllowed(process.env)) return unavailable;
    const url = process.env["SUPABASE_URL"],
      key = process.env["SUPABASE_PUBLISHABLE_KEY"];
    if (!url || !key) return unavailable;
    try {
      const result = await publicClient(url, key).rpc("open_lead_session", { _key: data.formKey });
      if (result.error) return { ok: false as const, error: leadError(result.error.message) };
      const parsed = z.guid().safeParse(result.data);
      if (!parsed.success) return unavailable;
      return { ok: true as const, sessionId: parsed.data };
    } catch {
      return unavailable;
    }
  });
export const submitPublicLead = createServerFn({ method: "POST" })
  .inputValidator((input: unknown) => leadSubmitSchema.parse(input))
  .handler(async ({ data }) => {
    if (!leadRuntimeAllowed(process.env)) return unavailable;
    const url = process.env["SUPABASE_URL"],
      key = process.env["SUPABASE_PUBLISHABLE_KEY"];
    if (!url || !key) return unavailable;
    try {
      const result = await publicClient(url, key).rpc("submit_public_lead", {
        _input: data as Json,
      });
      if (result.error) return { ok: false as const, error: leadError(result.error.message) };
      return result.data === true ? { ok: true as const } : unavailable;
    } catch {
      return unavailable;
    }
  });
export const configureLeadForm = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => leadFormConfigSchema.parse(input))
  .handler(async ({ data, context }) => {
    if (!leadRuntimeAllowed(process.env)) return unavailable;
    const client = context.supabase as unknown as SupabaseClient<LeadDatabase>;
    const result = await client.rpc("configure_lead_form", { _input: data as Json });
    if (result.error || !result.data) return unavailable;
    return { ok: true as const, id: result.data };
  });
export const qualifyLead = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) =>
    z
      .object({
        submissionId: z.guid(),
        decision: z.enum(["qualified", "not_fit"]),
        note: z.string().trim().min(1).max(1000),
      })
      .parse(input),
  )
  .handler(async ({ data, context }) => {
    if (!leadRuntimeAllowed(process.env)) return unavailable;
    const client = context.supabase as unknown as SupabaseClient<LeadDatabase>;
    const result = await client.rpc("qualify_lead", {
      _submission: data.submissionId,
      _decision: data.decision,
      _note: data.note,
    });
    if (result.error || !result.data) return unavailable;
    return { ok: true as const, id: result.data };
  });
export const prepareLeadFollowup = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) =>
    z
      .object({
        submissionId: z.guid(),
        title: z.string().trim().min(1).max(200),
        due: z.iso.date().nullable(),
      })
      .parse(input),
  )
  .handler(async ({ data, context }) => {
    if (!leadRuntimeAllowed(process.env)) return unavailable;
    const client = context.supabase as unknown as SupabaseClient<LeadDatabase>;
    const result = await client.rpc("prepare_lead_followup", {
      _submission: data.submissionId,
      _title: data.title,
      _due: data.due,
    });
    if (result.error || !result.data) return unavailable;
    return { ok: true as const, id: result.data };
  });
