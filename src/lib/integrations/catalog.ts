// Integration Hub catalogue shared by the screens, the server actions and tests. The database (proposal 0065)
// enforces the same rules: integration_provider, external_action_spec and specialist_external_actions. A Vitest
// test keeps this file and the SQL in step.
import { z } from "zod";
import { SPECIALIST_KEYS, type TaskSpecialist } from "@/lib/task-execution";

export const LEVELS = ["read", "draft", "modify", "execute", "publish", "budget"] as const;
export type Level = (typeof LEVELS)[number];
export type Category =
  "advertising" | "analytics" | "crm" | "email" | "automation" | "payments" | "website";

export type Provider = {
  key: string;
  base: string;
  name: string;
  category: Category;
  levels: readonly Level[];
  simulated: boolean;
};
const p = (key: string, name: string, category: Category, levels: readonly Level[]): Provider => ({
  key,
  base: key.replace(/^sim\./, ""),
  name,
  category,
  levels,
  simulated: key.startsWith("sim."),
});

/** Real providers are read-only in this phase; every write level exists only on simulated providers. */
export const PROVIDERS: readonly Provider[] = [
  p("google_analytics", "Google Analytics", "analytics", ["read"]),
  p("search_console", "Google Search Console", "analytics", ["read"]),
  p("hubspot", "HubSpot", "crm", ["read"]),
  p("stripe", "Stripe", "payments", ["read"]),
  p("sim.google_ads", "Google Ads", "advertising", [
    "read",
    "draft",
    "modify",
    "publish",
    "budget",
  ]),
  p("sim.meta_ads", "Meta Ads", "advertising", ["read", "draft", "modify", "publish", "budget"]),
  p("sim.linkedin_ads", "LinkedIn Ads", "advertising", [
    "read",
    "draft",
    "modify",
    "publish",
    "budget",
  ]),
  p("sim.google_analytics", "Google Analytics", "analytics", ["read"]),
  p("sim.search_console", "Google Search Console", "analytics", ["read"]),
  p("sim.hubspot", "HubSpot", "crm", ["read", "draft", "modify", "execute"]),
  p("sim.salesforce", "Salesforce", "crm", ["read", "draft", "modify", "execute"]),
  p("sim.mailchimp", "Mailchimp", "email", ["read", "draft", "publish"]),
  p("sim.automation", "Marketing automation", "automation", ["read", "draft", "execute"]),
  p("sim.stripe", "Stripe", "payments", ["read"]),
  p("sim.wordpress", "WordPress", "website", ["read", "draft", "modify", "publish"]),
];
export const SIMULATED_PROVIDERS = PROVIDERS.filter((x) => x.simulated);
export const providerByKey = (k: string) => PROVIDERS.find((x) => x.key === k);

export type FieldKind = "text" | "textarea" | "url" | "money";
export type Field = { key: string; kind: FieldKind; required: boolean };
export type ActionSpec = {
  type: string;
  level: Level;
  providers: readonly string[];
  state: string;
  fields: readonly Field[];
};
const f = (key: string, kind: FieldKind, required = true): Field => ({ key, kind, required });
const ADS = ["google_ads", "meta_ads", "linkedin_ads"] as const;

export const ACTIONS: readonly ActionSpec[] = [
  {
    type: "ads.create_campaign_draft",
    level: "draft",
    providers: ADS,
    state: "paused_draft",
    fields: [f("name", "text"), f("audience", "textarea", false), f("message", "textarea", false)],
  },
  {
    type: "ads.launch_campaign",
    level: "publish",
    providers: ADS,
    state: "active",
    fields: [f("name", "text")],
  },
  {
    type: "ads.change_budget",
    level: "budget",
    providers: ADS,
    state: "budget_updated",
    fields: [f("name", "text"), f("daily_budget", "money")],
  },
  {
    type: "crm.create_task",
    level: "execute",
    providers: ["hubspot", "salesforce"],
    state: "open",
    fields: [f("subject", "text"), f("notes", "textarea", false)],
  },
  {
    type: "crm.update_deal",
    level: "modify",
    providers: ["hubspot", "salesforce"],
    state: "updated",
    fields: [f("deal", "text"), f("change", "textarea")],
  },
  {
    type: "email.prepare_draft",
    level: "draft",
    providers: ["mailchimp", "automation"],
    state: "draft",
    fields: [f("subject", "text"), f("body", "textarea")],
  },
  {
    type: "email.send_campaign",
    level: "publish",
    providers: ["mailchimp"],
    state: "sent",
    fields: [f("subject", "text"), f("body", "textarea")],
  },
  {
    type: "automation.create_workflow_draft",
    level: "draft",
    providers: ["automation"],
    state: "draft",
    fields: [f("name", "text"), f("steps", "textarea", false)],
  },
  {
    type: "content.save_draft",
    level: "draft",
    providers: ["wordpress"],
    state: "draft",
    fields: [f("title", "text"), f("body", "textarea")],
  },
  {
    type: "content.publish",
    level: "publish",
    providers: ["wordpress"],
    state: "published",
    fields: [f("title", "text"), f("body", "textarea")],
  },
  {
    type: "seo.update_metadata",
    level: "modify",
    providers: ["wordpress"],
    state: "saved",
    fields: [f("url", "url"), f("meta_title", "text"), f("meta_description", "textarea", false)],
  },
];
export const actionByType = (t: string) => ACTIONS.find((a) => a.type === t);

/** Typed, bounded action details; the database checks required fields again. */
export function payloadSchema(spec: ActionSpec) {
  const shape: Record<string, z.ZodTypeAny> = {};
  for (const x of spec.fields) {
    const base =
      x.kind === "url"
        ? z.string().trim().url().max(500)
        : x.kind === "money"
          ? z
              .string()
              .trim()
              .regex(/^\d+(\.\d{1,2})?$/)
              .refine((v) => Number(v) > 0 && Number(v) <= 100000)
          : z
              .string()
              .trim()
              .min(x.required ? 1 : 0)
              .max(x.kind === "textarea" ? 4000 : 200);
    shape[x.key] = x.required ? base : base.optional();
  }
  return z.object(shape).strict();
}

export type DataKind =
  | "profile"
  | "facts"
  | "tasks"
  | "goals"
  | "budget"
  | "analytics"
  | "search"
  | "crm"
  | "payments"
  | "content"
  | "competitors";
export type SpecialistDeclaration = {
  /** business data it may read (always under the caller's permissions) */
  reads: readonly DataKind[];
  /** integration categories it may use */
  integrations: readonly Category[];
  /** external action types it may prepare */
  prepares: readonly string[];
};
const S = (
  reads: DataKind[],
  integrations: Category[],
  prepares: string[],
): SpecialistDeclaration => ({ reads, integrations, prepares });

export const SPECIALIST_INTEGRATIONS: Record<TaskSpecialist, SpecialistDeclaration> = {
  business_analyst: S(
    ["profile", "facts", "tasks", "goals", "budget", "payments"],
    ["payments", "analytics"],
    [],
  ),
  market_research: S(["profile", "facts", "competitors", "search"], ["analytics"], []),
  growth_strategist: S(
    ["profile", "facts", "goals", "budget", "tasks", "analytics"],
    ["analytics"],
    [],
  ),
  seo: S(
    ["profile", "facts", "search", "content"],
    ["analytics", "website"],
    ["seo.update_metadata", "content.save_draft"],
  ),
  content: S(
    ["profile", "facts", "content"],
    ["website"],
    ["content.save_draft", "content.publish"],
  ),
  copywriter: S(
    ["profile", "facts", "content"],
    ["website", "email"],
    ["content.save_draft", "email.prepare_draft"],
  ),
  marketing: S(
    ["profile", "facts", "goals", "budget", "analytics"],
    ["advertising", "email", "automation", "analytics"],
    ["ads.create_campaign_draft", "email.prepare_draft", "automation.create_workflow_draft"],
  ),
  advertising: S(
    ["profile", "facts", "budget", "analytics"],
    ["advertising", "analytics"],
    ["ads.create_campaign_draft", "ads.launch_campaign", "ads.change_budget"],
  ),
  linkedin: S(["profile", "facts", "content"], ["advertising"], ["ads.create_campaign_draft"]),
  sales: S(["profile", "facts", "crm"], ["crm"], ["crm.create_task"]),
  crm: S(["profile", "facts", "crm"], ["crm"], ["crm.create_task", "crm.update_deal"]),
  cro: S(
    ["profile", "facts", "analytics", "content"],
    ["analytics", "website"],
    ["seo.update_metadata", "content.save_draft"],
  ),
  partnership: S(["profile", "facts", "crm"], ["crm"], ["crm.create_task"]),
  event_marketing: S(
    ["profile", "facts", "content"],
    ["email"],
    ["email.prepare_draft", "email.send_campaign"],
  ),
  revenue_analyst: S(
    ["profile", "facts", "payments", "crm", "budget"],
    ["payments", "crm", "analytics"],
    [],
  ),
};

/** Approval rule (mirrors submit_external_action): only draft-level work may be approved by the bounded-autonomy policy. */
export const approvalRequired = (level: Level, mode: number) => !(level === "draft" && mode === 4);
/** Execution of publish and budget levels needs an administrator (mirrors begin_external_action_verified). */
export const adminToExecute = (level: Level) => level === "publish" || level === "budget";

/** What a specialist may do with a given connection: prepare → actions it may prepare that the provider supports. */
export function preparableActions(specialist: TaskSpecialist, providerKey: string) {
  const prov = providerByKey(providerKey);
  if (!prov) return [];
  return SPECIALIST_INTEGRATIONS[specialist].prepares
    .map(actionByType)
    .filter(
      (a): a is ActionSpec =>
        !!a && a.providers.includes(prov.base) && prov.levels.includes(a.level),
    );
}
export const isSpecialist = (s: string): s is TaskSpecialist =>
  (SPECIALIST_KEYS as readonly string[]).includes(s);
