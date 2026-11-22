// The guided "getting to know your business" questions (pure manifest, no AI, no credits).
// Every answer is stored as a confirmed business fact (source "Onboarding answer") through the role-checked SQL function
// save_business_answers (proposal 0091), so there is no second onboarding store: the Business Knowledge view, the
// Growth Officer context, reports and the next step all read the same facts. `key` is the stored fact key and must stay
// stable; the SQL allowlist in docs/proposals/0091_business_answers.sql is tested against this list.

export const ANSWER_SOURCE = "Onboarding answer";

export type SectionId = "customers" | "sales" | "challenges" | "resources" | "ambitions" | "constraints";
export type QuestionKind = "single" | "multi" | "text";
export type Question = {
  id: string;
  section: SectionId;
  /** Stored business-fact key (English, stable). */
  key: string;
  kind: QuestionKind;
  /** Asked first and counted for progress; the others are optional extra detail. */
  core: boolean;
  options?: readonly string[];
  /** Options are the choices picked in another question (e.g. "which challenge matters most"). */
  optionsFrom?: string;
  /** Multi-choice questions that accept an own answer next to the choices. */
  other?: boolean;
  /** Only asked when this earlier answer makes it relevant. */
  showIf?: { question: string; anyOf?: readonly string[]; minChoices?: number };
  /** Existing business detail (profile field or discovery fact key) shown as a hint, so nothing is asked twice. */
  hint?: "audiences" | "channels" | "offerings" | "markets" | "objectives" | "budget";
  /** Business-understanding area the answer belongs to. */
  area: "customers" | "sales" | "challenges" | "resources" | "ambitions" | "horizon" | "constraints";
};

const q = (x: Question) => x;

export const QUESTIONS: readonly Question[] = [
  // Customers
  q({ id: "customer_type", section: "customers", key: "Customer type", kind: "single", core: true, options: ["b2b", "b2c", "both", "public"], area: "customers" }),
  q({ id: "ideal_customer", section: "customers", key: "Ideal customer", kind: "text", core: true, hint: "audiences", area: "customers" }),
  q({ id: "customer_needs", section: "customers", key: "Customer needs and problems", kind: "text", core: true, area: "customers" }),
  q({ id: "segments", section: "customers", key: "Customer segments", kind: "text", core: false, hint: "markets", area: "customers" }),
  q({ id: "repeat", section: "customers", key: "Repeat purchases", kind: "single", core: false, options: ["one_off", "sometimes", "often", "subscription", "unsure"], area: "customers" }),
  // Sales process
  q({ id: "discovery_channels", section: "sales", key: "How customers find the business", kind: "multi", core: true, other: true, options: ["referrals", "search", "social", "ads", "partners", "events", "outreach", "marketplaces", "walk_in"], hint: "channels", area: "sales" }),
  q({ id: "enquiries", section: "sales", key: "How enquiries come in", kind: "multi", core: true, other: true, options: ["email", "phone", "form", "chat", "in_person", "checkout"], area: "sales" }),
  q({ id: "sales_cycle", section: "sales", key: "Typical sales cycle", kind: "single", core: true, options: ["same_day", "days", "weeks", "months", "unsure"], area: "sales" }),
  q({ id: "decision", section: "sales", key: "Who decides on a purchase", kind: "text", core: false, showIf: { question: "customer_type", anyOf: ["b2b", "both", "public"] }, area: "sales" }),
  q({ id: "obstacles", section: "sales", key: "Why interested people do not buy", kind: "text", core: false, area: "sales" }),
  q({ id: "follow_up", section: "sales", key: "Follow-up after an enquiry", kind: "single", core: false, options: ["none", "manual", "automated", "unsure"], area: "sales" }),
  q({ id: "sales_tools", section: "sales", key: "Sales and CRM tools", kind: "text", core: false, area: "sales" }),
  // Challenges: the person picks what applies; nothing is assumed.
  q({ id: "challenges", section: "challenges", key: "Business challenges", kind: "multi", core: true, other: true, options: ["few_leads", "few_customers", "low_conversion", "retention", "order_value", "awareness", "inefficient_marketing", "sales_capacity", "acquisition_cost", "operations"], area: "challenges" }),
  q({ id: "main_challenge", section: "challenges", key: "Biggest challenge", kind: "single", core: false, optionsFrom: "challenges", showIf: { question: "challenges", minChoices: 2 }, area: "challenges" }),
  // Resources
  q({ id: "hours", section: "resources", key: "Time available for growth each week", kind: "single", core: true, options: ["lt2", "h2_5", "h5_10", "h10plus", "team"], area: "resources" }),
  q({ id: "team", section: "resources", key: "Who can help with growth", kind: "multi", core: true, options: ["just_me", "internal_team", "marketing_staff", "sales_staff", "agency", "freelancers"], area: "resources" }),
  q({ id: "capacity", section: "resources", key: "Room to take on more customers", kind: "single", core: true, options: ["plenty", "some", "nearly_full", "full"], area: "resources" }),
  q({ id: "content", section: "resources", key: "Content and creative resources", kind: "multi", core: false, options: ["writing", "photo_video", "design", "none"], area: "resources" }),
  q({ id: "tools", section: "resources", key: "Marketing tools in use", kind: "text", core: false, area: "resources" }),
  // Ambitions and time horizon
  q({ id: "outcomes", section: "ambitions", key: "Desired outcomes", kind: "multi", core: true, other: true, options: ["more_leads", "more_customers", "revenue", "order_value", "retention", "new_markets", "new_products", "profitability", "awareness"], hint: "objectives", area: "ambitions" }),
  q({ id: "horizon", section: "ambitions", key: "Time horizon for results", kind: "single", core: true, options: ["d30", "d90", "m6", "m12", "longer"], area: "horizon" }),
  q({ id: "priority_now", section: "ambitions", key: "Priority for the next 30 days", kind: "text", core: false, area: "horizon" }),
  q({ id: "revenue_ambition", section: "ambitions", key: "Revenue ambition", kind: "text", core: false, area: "ambitions" }),
  // Boundaries
  q({ id: "excluded_channels", section: "constraints", key: "Channels not to use", kind: "multi", core: true, other: true, options: ["no_limits", "cold_calling", "paid_ads", "social", "email", "discounts", "influencers"], area: "constraints" }),
  q({ id: "approvals", section: "constraints", key: "Who must approve work", kind: "single", core: true, options: ["owner_all", "team_small", "formal"], area: "constraints" }),
  q({ id: "excluded_activities", section: "constraints", key: "Activities the business does not want", kind: "text", core: false, area: "constraints" }),
  q({ id: "regulation", section: "constraints", key: "Rules and regulations to respect", kind: "text", core: false, area: "constraints" }),
  q({ id: "brand_rules", section: "constraints", key: "Brand requirements", kind: "text", core: false, area: "constraints" }),
  q({ id: "geography", section: "constraints", key: "Geographic limits", kind: "text", core: false, area: "constraints" }),
];

/** Order of the guided steps: most useful for growth advice first. */
export const SECTIONS: readonly SectionId[] = ["customers", "sales", "challenges", "resources", "ambitions", "constraints"];

export const ANSWER_KEYS: readonly string[] = QUESTIONS.map((x) => x.key);
export const questionById = (id: string) => QUESTIONS.find((x) => x.id === id);
export const sectionQuestions = (s: SectionId) => QUESTIONS.filter((x) => x.section === s);
