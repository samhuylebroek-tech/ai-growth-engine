import { z } from "zod";
import type { Database, Json } from "@/integrations/supabase/types";
import { checkRuntimeEnvironment } from "@/lib/environment";

export const formKeySchema = z
  .string()
  .trim()
  .regex(/^[a-z0-9-]{8,64}$/);
export const leadCopySchema = z.object({
  title: z.string().trim().min(1).max(160),
  intro: z.string().trim().max(600),
  consent: z.string().trim().min(20).max(1000),
});
export const publicLeadFormSchema = z.object({
  key: formKeySchema,
  businessName: z.string().trim().min(1).max(160),
  privacyUrl: z
    .url()
    .max(1000)
    .refine((v) => new URL(v).protocol === "https:"),
  copy: z.object({ en: leadCopySchema, nl: leadCopySchema, fr: leadCopySchema }),
});
export type PublicLeadForm = z.infer<typeof publicLeadFormSchema>;
export const leadFormConfigSchema = publicLeadFormSchema.extend({
  workspaceId: z.guid(),
  active: z.boolean(),
  dailyLimit: z.number().int().min(1).max(1000),
  hourlyLimit: z.number().int().min(1).max(100),
});
export const leadSubmitSchema = z.object({
  formKey: formKeySchema,
  sessionId: z.guid(),
  requestId: z.guid(),
  name: z.string().trim().min(1).max(120),
  email: z.string().trim().toLowerCase().email().max(255),
  phone: z.string().trim().max(40).default(""),
  message: z.string().trim().max(2000).default(""),
  consent: z.literal(true),
  consentText: z.string().trim().min(20).max(1000),
  privacyUrl: z.url().max(1000),
  website: z.string().max(0).default(""),
  locale: z.enum(["en", "nl", "fr"]),
  attribution: z
    .object({
      source: z.string().trim().max(120).default(""),
      medium: z.string().trim().max(120).default(""),
      campaign: z.string().trim().max(120).default(""),
    })
    .default({ source: "", medium: "", campaign: "" }),
});
export type LeadSubmit = z.infer<typeof leadSubmitSchema>;
/** Lead writes are deliberately unavailable in the connected production preview. */
export function leadRuntimeAllowed(env: Record<string, string | undefined>) {
  const check = checkRuntimeEnvironment(env);
  return check.environment === "staging" && check.problems.length === 0;
}
export type LeadError = "unavailable" | "invalid" | "limited" | "expired";
export function leadError(message: string): LeadError {
  if (message.includes("lead_limited")) return "limited";
  if (message.includes("lead_expired")) return "expired";
  if (message.includes("lead_invalid")) return "invalid";
  return "unavailable";
}
export type LeadFormRow = {
  id: string;
  org_id: string;
  workspace_id: string;
  form_key: string;
  business_name: string;
  privacy_url: string;
  copy: Json;
  active: boolean;
  daily_limit: number;
  hourly_limit: number;
  created_by: string;
  created_at: string;
};
export type LeadSubmissionRow = {
  id: string;
  org_id: string;
  workspace_id: string;
  form_id: string;
  contact_id: string;
  request_id: string;
  name: string;
  email: string;
  phone: string;
  message: string;
  locale: "en" | "nl" | "fr";
  consent_text: string;
  privacy_url: string;
  attribution: Json;
  created_at: string;
};
export type LeadDecisionRow = {
  id: string;
  org_id: string;
  workspace_id: string;
  submission_id: string;
  decision: "qualified" | "not_fit";
  note: string;
  created_by: string;
  created_at: string;
};
export type LeadFollowupRow = {
  id: string;
  org_id: string;
  workspace_id: string;
  submission_id: string;
  task_id: string;
  created_by: string;
  created_at: string;
};
export const LEAD_TRIAGE = ["pending", "qualified", "ready", "not_fit"] as const;
export type LeadTriage = (typeof LEAD_TRIAGE)[number];
/** Latest human decision wins; a recorded follow-up proves preparation, never execution. */
export function leadTriage(
  submissionId: string,
  decisions: readonly Pick<LeadDecisionRow, "submission_id" | "decision" | "id" | "created_at">[],
  followups: readonly Pick<LeadFollowupRow, "submission_id">[],
): LeadTriage {
  const latest = decisions
    .filter((d) => d.submission_id === submissionId)
    .sort((a, b) => b.created_at.localeCompare(a.created_at) || b.id.localeCompare(a.id))[0];
  if (!latest) return "pending";
  if (latest.decision === "not_fit") return "not_fit";
  return followups.some((f) => f.submission_id === submissionId) ? "ready" : "qualified";
}
type Table<R> = { Row: R; Insert: Partial<R>; Update: Partial<R>; Relationships: [] };
/** Additive proposal types, not a claim that the connected database has this schema. */
export type LeadDatabase = Omit<Database, "public"> & {
  public: Omit<Database["public"], "Tables" | "Functions"> & {
    Tables: Database["public"]["Tables"] & {
      lead_forms: Table<LeadFormRow>;
      lead_submissions: Table<LeadSubmissionRow>;
      lead_decisions: Table<LeadDecisionRow>;
      lead_followups: Table<LeadFollowupRow>;
    };
    Functions: Database["public"]["Functions"] & {
      public_lead_form: { Args: { _key: string }; Returns: Json };
      open_lead_session: { Args: { _key: string }; Returns: string };
      submit_public_lead: { Args: { _input: Json }; Returns: boolean };
      configure_lead_form: { Args: { _input: Json }; Returns: string };
      qualify_lead: {
        Args: { _submission: string; _decision: string; _note: string };
        Returns: string;
      };
      prepare_lead_followup: {
        Args: { _submission: string; _title: string; _due: string | null };
        Returns: string;
      };
    };
  };
};
