import type { SupabaseClient } from "@supabase/supabase-js";
import { supabase } from "@/integrations/supabase/client";
import type { Database, Json } from "@/integrations/supabase/types";

/**
 * Schema added by committed-but-not-yet-applied migrations 0043_atomic_growth_strategy_conversion, 0046–0052 and
 * 0056_performance_measurements, plus the staging-only proposals 0057/0059 (read-only connectors) and 0060 (revenue opportunities)
 * (see docs/MIGRATION_POLICY.md). The generated types follow the connected database, which does not have these
 * objects yet, so the growth plan/initiative screens type against this extension. At runtime the database still
 * answers "not found" for these objects until the migrations are applied; screens must keep their error states.
 * Delete this file once the generated types contain these tables.
 */
type Public = Database["public"];
type GeneratedTables = Public["Tables"];
type GeneratedFunctions = Public["Functions"];

type PlanRow = {
  approved_at: string | null;
  approved_by: string | null;
  created_at: string;
  created_by: string;
  goal_id: string;
  id: string;
  org_id: string;
  plan_snapshot: Json;
  strategic_thesis: string;
  status: string;
  strategy_id: string;
  summary: string;
  title: string;
  version: number;
  workspace_id: string;
};
export type ExecutionSettingsRow = {
  workspace_id: string;
  org_id: string;
  mode: number;
  max_credits_per_run: number;
  monthly_credit_cap: number;
  updated_by: string | null;
  updated_at: string;
  paused: boolean;
  pause_reason: string | null;
  paused_by: string | null;
  paused_at: string | null;
  daily_credit_cap: number | null;
  max_parallel: number;
  max_attempts: number;
  allowed_specialists: string[];
  window_start: number | null;
  window_end: number | null;
  timezone: string;
  schedule: "off" | "daily" | "weekdays";
  schedule_hour: number;
};
export type ExecutionCycleRow = {
  id: string;
  org_id: string;
  workspace_id: string;
  request_key: string;
  trigger: "manual" | "scheduled";
  reason: string;
  status: "open" | "completed" | "stopped";
  stop_reason: "paused" | "expired" | "finished_early" | null;
  limits: Json;
  queued: number;
  awaiting: number;
  skipped: number;
  summary: Json | null;
  started_by: string;
  created_at: string;
  finished_at: string | null;
};
export type ExecutionCycleItemRow = {
  cycle_id: string;
  org_id: string;
  workspace_id: string;
  task_id: string;
  rank: number;
  score: number;
  decision: "queued" | "awaiting_approval" | "skipped";
  reason: string;
  run_id: string | null;
};
export type TaskProfileRow = {
  task_id: string;
  org_id: string;
  workspace_id: string;
  specialist_key: string;
  task_type: "analysis" | "preparation" | "external";
  requires_approval: boolean;
  assigned_by: string;
  assigned_at: string;
};
export type TaskRunRow = {
  id: string;
  org_id: string;
  workspace_id: string;
  task_id: string;
  request_key: string;
  specialist_key: string;
  task_type: "analysis" | "preparation";
  mode: number;
  attempt: number;
  status:
    | "awaiting_approval"
    | "queued"
    | "paused"
    | "running"
    | "succeeded"
    | "failed"
    | "uncertain"
    | "cancelled"
    | "rejected";
  estimated_credits: number;
  credits_charged: number | null;
  single_request_id: string | null;
  agent_run_id: string | null;
  output: Json | null;
  error: string | null;
  decision_note: string | null;
  decided_by: string | null;
  lease_until: string | null;
  requested_by: string;
  created_at: string;
  started_at: string | null;
  finished_at: string | null;
  updated_at: string;
  cycle_id: string | null;
};
export type PlanDecisionRow = {
  id: string;
  org_id: string;
  workspace_id: string;
  plan_version_id: string;
  decision: "approved" | "rejected" | "changes_requested";
  note: string;
  decided_by: string;
  decided_at: string;
};
type InitiativeRow = {
  project_id: string | null;
  channel: string;
  created_at: string;
  detail: string;
  effort: string;
  goal_id: string;
  id: string;
  org_id: string;
  plan_version_id: string;
  sort_order: number;
  status: string;
  target_week: number;
  title: string;
  workspace_id: string;
};
type OperationRow = {
  initiative_id: string;
  org_id: string;
  workspace_id: string;
  owner_id: string | null;
  due_date: string | null;
  success_metric: string;
  baseline_value: number | null;
  target_value: number | null;
  current_value: number | null;
  blocker_note: string;
  updated_by: string;
  updated_at: string;
};

type MetricRow = {
  id: string;
  org_id: string;
  workspace_id: string;
  key: string;
  label: string;
  unit: string;
  currency: string | null;
  direction: string;
  goal_id: string | null;
  initiative_id: string | null;
  archived: boolean;
  campaign_id: string | null;
  unit_id: string | null;
  channel: string;
  category: string;
  created_by: string;
  created_at: string;
  updated_at: string;
};
export type ExchangeRateRow = {
  id: string;
  org_id: string;
  base_currency: string;
  quote_currency: string;
  rate: number;
  rate_date: string;
  source: string;
  kind: "manual" | "official";
  created_by: string;
  created_at: string;
};
export type SpecialistAllocationRow = {
  workspace_id: string;
  org_id: string;
  specialist_key: string;
  enabled: boolean;
  priority: number;
  monthly_credit_cap: number | null;
  updated_by: string;
  updated_at: string;
};
export type BusinessUnitRow = {
  id: string;
  org_id: string;
  workspace_id: string;
  kind: "brand" | "unit";
  name: string;
  parent_id: string | null;
  archived: boolean;
  created_by: string;
  created_at: string;
};
export type RevenueEventRow = {
  id: string;
  org_id: string;
  workspace_id: string;
  unit_id: string | null;
  kind: "sale" | "refund" | "cancellation" | "correction";
  amount: number;
  currency: string;
  occurred_at: string;
  data_class: "imported" | "manual" | "estimated";
  source: string;
  source_ref: string;
  customer_ref: string;
  deal_id: string | null;
  relates_to: string | null;
  note: string;
  request_key: string;
  created_by: string;
  created_at: string;
};
export type TouchpointRow = {
  id: string;
  org_id: string;
  workspace_id: string;
  revenue_event_id: string;
  campaign_id: string | null;
  initiative_id: string | null;
  channel: string;
  touched_at: string;
  evidence: "verified_link" | "tracked" | "manual";
  source: string;
  source_ref: string;
  request_key: string;
  retracted_at: string | null;
  retracted_by: string | null;
  created_by: string;
  created_at: string;
};
export type ExperimentStatus =
  | "draft"
  | "in_review"
  | "proposed"
  | "approved"
  | "rejected"
  | "scheduled"
  | "running"
  | "collecting"
  | "evaluating"
  | "paused"
  | "completed"
  | "cancelled";
export type ExperimentEventRow = {
  id: string;
  org_id: string;
  workspace_id: string;
  experiment_id: string;
  action: string;
  from_status: string | null;
  to_status: string;
  note: string;
  data: Json;
  actor_id: string;
  created_at: string;
};
export type ExperimentObservationRow = {
  id: string;
  org_id: string;
  workspace_id: string;
  experiment_id: string;
  request_key: string;
  observed_on: string;
  variant_n: number;
  variant_conversions: number;
  control_n: number;
  control_conversions: number;
  data_class: "manual" | "simulated" | "imported";
  note: string;
  recorded_by: string;
  created_at: string;
};
export type ExperimentRow = {
  id: string;
  org_id: string;
  workspace_id: string;
  unit_id: string | null;
  goal_id: string | null;
  campaign_id: string | null;
  metric_id: string | null;
  request_key: string;
  origin: "team" | "growth_officer" | "rule";
  title: string;
  hypothesis: string;
  objective: string;
  audience: string;
  intervention: string;
  budget: number | null;
  currency: string | null;
  expected_result: string;
  success_metric: string;
  duration_days: number;
  risks: string;
  method: "ab_test" | "comparison_group" | "before_after" | "observational";
  status: ExperimentStatus;
  decided_by: string | null;
  decided_at: string | null;
  decision_note: string;
  started_at: string | null;
  ended_at: string | null;
  variant_value: number | null;
  control_value: number | null;
  variant_n: number | null;
  control_n: number | null;
  actual_result: string;
  conclusion: string;
  evidence_strength: "controlled" | "correlational" | "inconclusive" | null;
  z_score?: number | null;
  // proposal 0079
  primary_kpi?: string;
  secondary_kpis?: string[];
  control_description?: string;
  baseline_rate?: number | null;
  min_effect?: number | null;
  sample_per_group?: number | null;
  success_criteria?: string;
  stop_criteria?: string;
  guardrail_min_rate?: number | null;
  scheduled_start?: string | null;
  paused_from?: "running" | "collecting" | null;
  outcome?: "successful" | "unsuccessful" | "inconclusive" | null;
  follow_up_of?: string | null;
  reviewed_by?: string | null;
  design_version?: number;
  result_data_class?: "manual" | "simulated" | "imported" | null;
  created_by: string;
  created_at: string;
  updated_at: string;
};
export type ProposalRow = {
  id: string;
  org_id: string;
  workspace_id: string;
  unit_id: string | null;
  goal_id: string | null;
  campaign_id: string | null;
  initiative_id: string | null;
  metric_id: string | null;
  task_id: string | null;
  request_key: string;
  source_key: string;
  origin: "rule" | "team" | "growth_officer";
  category: "immediate" | "strategic" | "opportunity" | "problem" | "experiment";
  title: string;
  change: string;
  reason: string;
  evidence: Json;
  uncertainty: string;
  expected_impact: string;
  est_cost: number | null;
  currency: string | null;
  est_credits: number | null;
  required_level: string;
  success_measure: string;
  measure_after: string | null;
  status: "proposed" | "approved" | "rejected" | "converted" | "measured" | "withdrawn";
  decided_by: string | null;
  decided_at: string | null;
  decision_note: string;
  outcome: "improved" | "no_change" | "worse" | "inconclusive" | null;
  outcome_note: string;
  measured_at: string | null;
  created_by: string;
  created_at: string;
  updated_at: string;
  /** Proposal 0073: evidence governance. */
  level: "observation" | "formal" | "execution";
  objective: string;
  risk: string;
  measurement_method: string;
  approval_requirement: string;
  business_context: string;
  evidence_gap_reason: string;
  reviewed_by: string | null;
  reviewed_at: string | null;
  review_note: string;
};
/** Proposal 0073: one piece of evidence; content immutable after classification, changes are new versions. */
export type EvidenceItemRow = {
  id: string;
  org_id: string;
  workspace_id: string;
  request_key: string;
  evidence_type: import("@/lib/evidence").EvidenceType | null;
  description: string;
  source_kind: import("@/lib/evidence").SourceKind;
  source_ref: string;
  origin: import("@/lib/evidence").EvidenceOrigin;
  goal_id: string | null;
  strategy_id: string | null;
  collected_at: string;
  period_start: string | null;
  period_end: string | null;
  status: import("@/lib/evidence").EvidenceStatus;
  reliability: "high" | "medium" | "low" | "none" | null;
  version_no: number;
  supersedes_id: string | null;
  superseded_by: string | null;
  reviewed_by: string | null;
  reviewed_at: string | null;
  review_note: string;
  created_by: string;
  created_at: string;
  updated_at: string;
};
/** Proposal 0075: insert-only history of a fact conflict (snapshot of every value at that moment). */
export type FactConflictEventRow = {
  id: string; org_id: string; workspace_id: string; topic: string;
  kind: "review_started" | "resolved" | "reopened";
  kept_fact_id: string | null; kept_value: string | null;
  snapshot: { id: string; value: string; source_type: string; source_ref: string | null; verified: boolean; created_at: string }[];
  note: string; actor_id: string; created_at: string;
};
/** Proposal 0075: insert-only decision about a next best action. */
export type RecommendationDecisionRow = {
  id: string; org_id: string; workspace_id: string; item_key: string;
  decision: "postponed" | "dismissed" | "restored"; until: string | null; fingerprint: string;
  note: string; actor_id: string; created_at: string;
};
/** Proposal 0076: a recorded business check (monitoring snapshot) and the per-business check frequency. */
export type BusinessCheckRow = {
  id: string; org_id: string; workspace_id: string;
  kind: "manual" | "daily" | "weekly" | "monthly" | "after_campaign" | "after_experiment";
  subject_id: string | null; inspected: Json; findings: Json;
  summary: { findings?: number; new?: number; still_open?: number; resolved?: number; first?: boolean } | Json;
  previous_id: string | null; actor_id: string; created_at: string;
};
/** Proposal 0077: re-planning proposals (insert-only) and their decisions; campaign spend ledger (insert-only). */
export type ReplanReason = "overdue" | "blocked" | "failed" | "dependency_late" | "awaiting_approval" | "no_owner" | "less_relevant" | "over_budget";
export type ReplanOption = {
  key: "a" | "b" | "c"; kind: "new_deadline" | "shift_chain" | "raise_priority" | "lower_priority";
  due_date?: string | null; priority?: "low" | "medium" | "high" | "urgent" | null; shifts?: { task_id: string; due_date: string; after?: string; moves?: boolean }[];
};
export type TaskReplanProposalRow = {
  id: string; org_id: string; workspace_id: string; task_id: string; request_key: string; origin: "rule" | "team";
  reasons: ReplanReason[]; options: ReplanOption[];
  snapshot: { due_date: string | null; priority: string; status: string; updated_at: string };
  impact: { affected?: string[]; campaign_end?: string | null; campaign_end_exceeded?: boolean; invalid_order?: string[] };
  risk: "low" | "medium" | "high"; credit_impact: number; rationale: string; created_by: string; created_at: string;
};
export type TaskReplanDecisionRow = {
  id: string; org_id: string; workspace_id: string; proposal_id: string; decision: "approved" | "rejected" | "postponed";
  option_key: "a" | "b" | "c" | null;
  applied: { before?: { due_date: string | null; priority: string }; after?: { due_date: string | null; priority: string }; adjusted?: boolean; shifted?: { task_id: string; from: string | null; to: string }[] };
  note: string; actor_id: string; created_at: string;
};
export type CampaignSpendRow = {
  id: string; org_id: string; workspace_id: string; campaign_id: string; kind: "spend" | "commitment" | "release" | "correction";
  amount: number | string; currency: string; occurred_on: string; data_class: "manual" | "simulated"; source_ref: string;
  relates_to: string | null; note: string; request_key: string; created_by: string; created_at: string;
};
export type BusinessCheckSettingsRow = {
  workspace_id: string; org_id: string; frequency: "off" | "daily" | "weekly" | "monthly"; updated_by: string; updated_at: string;
};
export type EvidenceEventRow = {
  id: number;
  org_id: string;
  workspace_id: string;
  evidence_id: string;
  action: string;
  from_status: string | null;
  to_status: string | null;
  proposal_id: string | null;
  actor_id: string | null;
  note: string;
  snapshot: Json;
  created_at: string;
};
export type ProposalEvidenceRow = {
  proposal_id: string;
  evidence_id: string;
  org_id: string;
  workspace_id: string;
  role: "supports" | "contradicts";
  linked_by: string;
  linked_at: string;
};
type MeasurementRow = {
  id: string;
  org_id: string;
  workspace_id: string;
  metric_id: string;
  period_start: string;
  period_end: string;
  kind: string;
  value: number;
  source: string;
  source_ref: string;
  note: string;
  request_key: string;
  corrects_id: string | null;
  created_by: string;
  created_at: string;
};

type ConnectionRow = GeneratedTables["connector_connections"]["Row"] & {
  account_label: string | null;
  scopes: string[];
  expires_at: string | null;
  last_checked_at: string | null;
  last_sync_at: string | null;
  last_error: string | null;
  granted_levels: string[];
  connected_by: string | null;
  connected_at: string | null;
  simulated: boolean;
};
export type ExternalActionRow = {
  id: string;
  org_id: string;
  workspace_id: string;
  request_key: string;
  task_id: string;
  project_id: string | null;
  campaign_id: string | null;
  goal_id: string | null;
  initiative_id: string | null;
  plan_version_id: string | null;
  strategy_id: string | null;
  connection_id: string;
  provider: string;
  simulated: boolean;
  specialist_key: string;
  action_type: string;
  required_level: string;
  title: string;
  description: string;
  payload: Json;
  estimated_cost: number | null;
  currency: string | null;
  stage:
    | "draft"
    | "in_review"
    | "approved"
    | "rejected"
    | "executing"
    | "executed"
    | "failed"
    | "uncertain"
    | "cancelled";
  approval_mode: "manual" | "policy" | null;
  decided_by: string | null;
  decided_at: string | null;
  decision_note: string;
  attempts: number;
  exec_key: string | null;
  external_ref: string | null;
  executed_at: string | null;
  error: string | null;
  verification: "not_verified" | "pending" | "verified" | "failed" | "unavailable";
  verified_at: string | null;
  evidence: Json;
  created_by: string;
  created_at: string;
  updated_at: string;
};
type SimRecordRow = {
  id: string;
  org_id: string;
  workspace_id: string;
  connection_id: string;
  request_key: string;
  action_type: string;
  external_ref: string;
  state: string;
  payload: Json;
  created_at: string;
};
type ImportRunRow = {
  id: string;
  org_id: string;
  workspace_id: string;
  connector_key: string;
  request_key: string;
  months: number;
  status: string;
  created_count: number;
  corrected_count: number;
  unchanged_count: number;
  skipped_count: number;
  error: string | null;
  started_by: string;
  started_at: string;
  finished_at: string | null;
};

export type OpportunityRow = {
  id: string;
  org_id: string;
  workspace_id: string;
  request_key: string;
  position: number;
  domain: string;
  title: string;
  summary: string;
  analysis: string;
  audience: string;
  expected_impact: string;
  impact: number;
  feasibility: number;
  cost: number;
  time_to_value: number;
  risk: number;
  complexity: string;
  budget_min: number | null;
  budget_max: number | null;
  currency: string;
  horizon_days: number;
  resources: string[];
  integrations: string[];
  risks: string[];
  kpis: Json;
  evidence: Json;
  confidence: string;
  status: string;
  goal_id: string | null;
  decided_by: string | null;
  decided_at: string | null;
  created_by: string;
  created_at: string;
};

/** Proposal 0070: organization growth intelligence (staging only until approved). */
export type OrgEvidence = { text: string; class: "verified" | "recorded" | "estimate" | "assumption" | "missing" };
export type OrgStrategyRow = {
  id: string; org_id: string; request_id: string; version: number; business_ids: string[]; title: string; summary: string;
  horizon_months: number; body: Json; status: "draft" | "approved" | "superseded" | "rejected"; created_by: string; created_at: string;
  decided_by: string | null; decided_at: string | null; decision_note: string;
};
export type OrgOpportunityRow = {
  id: string; org_id: string; strategy_id: string | null; origin: "rule" | "ai"; rule_key: string | null; kind: string; title: string;
  business_ids: string[]; evidence: Json; expected_impact: string; estimated_cost: string; dependencies: string; risks: string;
  confidence: "low" | "medium" | "high"; next_action: string; status: "hypothesis" | "validating" | "validated" | "dismissed" | "converted";
  created_by: string; created_at: string; updated_at: string; decided_by: string | null; decided_at: string | null; decision_note: string;
};
export type OrgInitiativeRow = {
  id: string; org_id: string; request_key: string; opportunity_id: string | null; strategy_id: string | null; title: string; shared_objective: string;
  success_metrics: Json; required_specialists: string[]; owner_id: string | null; business_ids: string[];
  status: "awaiting_commitments" | "committed" | "declined" | "active" | "completed" | "cancelled"; created_by: string; created_at: string; updated_at: string;
};
export type OrgCommitmentRow = {
  id: string; initiative_id: string; org_id: string; workspace_id: string; business_objective: string; budget_amount: number; currency: string;
  tasks: Json; status: "pending" | "approved" | "declined"; project_id: string | null; decided_by: string | null; decided_at: string | null;
  decision_note: string; created_at: string;
};
export type OrgAllocationRow = {
  id: string; org_id: string; request_key: string; kind: "budget_shift" | "specialist_capacity"; title: string; reasoning: string; payload: Json;
  business_ids: string[]; status: "pending" | "applied" | "rejected" | "withdrawn"; result: Json | null; created_by: string; created_at: string;
  decided_by: string | null; decided_at: string | null; decision_note: string;
};
type PendingTables = {
  growth_opportunities: {
    Row: OpportunityRow;
    Insert: Partial<OpportunityRow>;
    Update: never;
    Relationships: [];
  };
  connector_connections: {
    Row: ConnectionRow;
    Insert: Partial<ConnectionRow>;
    Update: Partial<ConnectionRow>;
    Relationships: GeneratedTables["connector_connections"]["Relationships"];
  };
  connector_import_runs: {
    Row: ImportRunRow;
    Insert: Partial<ImportRunRow>;
    Update: Partial<ImportRunRow>;
    Relationships: [];
  };
  metric_definitions: {
    Row: MetricRow;
    Insert: Partial<MetricRow>;
    Update: Partial<MetricRow>;
    Relationships: [
      {
        foreignKeyName: "metric_definitions_goal_id_org_id_workspace_id_fkey";
        columns: ["goal_id", "org_id", "workspace_id"];
        isOneToOne: false;
        referencedRelation: "growth_goals";
        referencedColumns: ["id", "org_id", "workspace_id"];
      },
    ];
  };
  performance_measurements: {
    Row: MeasurementRow;
    Insert: Partial<MeasurementRow>;
    Update: Partial<MeasurementRow>;
    Relationships: [
      {
        foreignKeyName: "performance_measurements_metric_id_org_id_workspace_id_fkey";
        columns: ["metric_id", "org_id", "workspace_id"];
        isOneToOne: false;
        referencedRelation: "metric_definitions";
        referencedColumns: ["id", "org_id", "workspace_id"];
      },
    ];
  };
  growth_plan_versions: {
    Row: PlanRow;
    Insert: Partial<PlanRow> &
      Pick<
        PlanRow,
        | "goal_id"
        | "org_id"
        | "plan_snapshot"
        | "strategy_id"
        | "summary"
        | "title"
        | "version"
        | "workspace_id"
      >;
    Update: Partial<PlanRow>;
    Relationships: [
      {
        foreignKeyName: "growth_plan_versions_goal_id_org_id_workspace_id_fkey";
        columns: ["goal_id", "org_id", "workspace_id"];
        isOneToOne: false;
        referencedRelation: "growth_goals";
        referencedColumns: ["id", "org_id", "workspace_id"];
      },
    ];
  };
  growth_initiatives: {
    Row: InitiativeRow;
    Insert: Partial<InitiativeRow> &
      Pick<
        InitiativeRow,
        "goal_id" | "org_id" | "plan_version_id" | "sort_order" | "title" | "workspace_id"
      >;
    Update: Partial<InitiativeRow>;
    Relationships: [
      {
        foreignKeyName: "growth_initiatives_plan_version_id_org_id_workspace_id_fkey";
        columns: ["plan_version_id", "org_id", "workspace_id"];
        isOneToOne: false;
        referencedRelation: "growth_plan_versions";
        referencedColumns: ["id", "org_id", "workspace_id"];
      },
      {
        foreignKeyName: "growth_initiatives_project_scope_fk";
        columns: ["project_id", "org_id", "workspace_id"];
        isOneToOne: true;
        referencedRelation: "projects";
        referencedColumns: ["id", "org_id", "workspace_id"];
      },
    ];
  };
  growth_plan_decisions: { Row: PlanDecisionRow; Insert: never; Update: never; Relationships: [] };
  execution_settings: {
    Row: ExecutionSettingsRow;
    Insert: never;
    Update: never;
    Relationships: [];
  };
  task_execution_profiles: { Row: TaskProfileRow; Insert: never; Update: never; Relationships: [] };
  task_runs: { Row: TaskRunRow; Insert: never; Update: never; Relationships: [] };
  execution_cycles: { Row: ExecutionCycleRow; Insert: never; Update: never; Relationships: [] };
  external_actions: { Row: ExternalActionRow; Insert: never; Update: never; Relationships: [] };
  business_units: { Row: BusinessUnitRow; Insert: never; Update: never; Relationships: [] };
  exchange_rates: { Row: ExchangeRateRow; Insert: never; Update: never; Relationships: [] };
  specialist_allocations: { Row: SpecialistAllocationRow; Insert: never; Update: never; Relationships: [] };
  org_strategies: { Row: OrgStrategyRow; Insert: never; Update: never; Relationships: [] };
  org_opportunities: { Row: OrgOpportunityRow; Insert: never; Update: never; Relationships: [] };
  org_initiatives: { Row: OrgInitiativeRow; Insert: never; Update: never; Relationships: [] };
  org_initiative_commitments: { Row: OrgCommitmentRow; Insert: never; Update: never; Relationships: [] };
  org_allocation_proposals: { Row: OrgAllocationRow; Insert: never; Update: never; Relationships: [] };
  revenue_events: { Row: RevenueEventRow; Insert: never; Update: never; Relationships: [] };
  attribution_touchpoints: { Row: TouchpointRow; Insert: never; Update: never; Relationships: [] };
  growth_experiments: { Row: ExperimentRow; Insert: never; Update: never; Relationships: [] };
  optimization_proposals: { Row: ProposalRow; Insert: never; Update: never; Relationships: [] };
  evidence_items: { Row: EvidenceItemRow; Insert: never; Update: never; Relationships: [] };
  evidence_events: { Row: EvidenceEventRow; Insert: never; Update: never; Relationships: [] };
  fact_conflict_events: { Row: FactConflictEventRow; Insert: never; Update: never; Relationships: [] };
  recommendation_decisions: { Row: RecommendationDecisionRow; Insert: never; Update: never; Relationships: [] };
  business_checks: { Row: BusinessCheckRow; Insert: never; Update: never; Relationships: [] };
  business_check_settings: { Row: BusinessCheckSettingsRow; Insert: never; Update: never; Relationships: [] };
  task_replan_proposals: { Row: TaskReplanProposalRow; Insert: never; Update: never; Relationships: [] };
  task_replan_decisions: { Row: TaskReplanDecisionRow; Insert: never; Update: never; Relationships: [] };
  campaign_spend_entries: { Row: CampaignSpendRow; Insert: never; Update: never; Relationships: [] };
  experiment_events: { Row: ExperimentEventRow; Insert: never; Update: never; Relationships: [] };
  experiment_observations: { Row: ExperimentObservationRow; Insert: never; Update: never; Relationships: [] };
  proposal_evidence: { Row: ProposalEvidenceRow; Insert: never; Update: never; Relationships: [] };
  simulated_provider_records: {
    Row: SimRecordRow;
    Insert: never;
    Update: never;
    Relationships: [];
  };
  execution_cycle_items: {
    Row: ExecutionCycleItemRow;
    Insert: never;
    Update: never;
    Relationships: [];
  };
  growth_initiative_operations: {
    Row: OperationRow;
    Insert: Partial<OperationRow> & Pick<OperationRow, "initiative_id" | "org_id" | "workspace_id">;
    Update: Partial<OperationRow>;
    Relationships: [
      {
        foreignKeyName: "growth_initiative_operations_initiative_id_org_id_workspace_id_fkey";
        columns: ["initiative_id", "org_id", "workspace_id"];
        isOneToOne: true;
        referencedRelation: "growth_initiatives";
        referencedColumns: ["id", "org_id", "workspace_id"];
      },
    ];
  };
};

/** Proposal 0067 adds 'editor' to org_role; the generated enum predates it. */
export type OrgRoleWithEditor = "owner" | "admin" | "editor" | "member" | "viewer";
type OrgMembers = GeneratedTables["organization_members"];
type PendingOrgMembers = {
  Row: Omit<OrgMembers["Row"], "role"> & { role: OrgRoleWithEditor };
  Insert: Omit<OrgMembers["Insert"], "role"> & { role?: OrgRoleWithEditor };
  Update: Omit<OrgMembers["Update"], "role"> & { role?: OrgRoleWithEditor };
  Relationships: OrgMembers["Relationships"];
};
/** Proposal 0068: optional brand/unit link on goals, campaigns and budget lines (same business only). */
type UnitLinked<T extends { Row: object; Insert: object; Update: object; Relationships: unknown }> = {
  Row: T["Row"] & { unit_id: string | null };
  Insert: T["Insert"] & { unit_id?: string | null };
  Update: T["Update"] & { unit_id?: string | null };
  Relationships: T["Relationships"];
};
type BusinessProfiles = GeneratedTables["business_profiles"];
type PendingBusinessProfiles = {
  Row: BusinessProfiles["Row"] & { reporting_currency: string };
  Insert: BusinessProfiles["Insert"];
  Update: BusinessProfiles["Update"];
  Relationships: BusinessProfiles["Relationships"];
};
type BudgetLines = GeneratedTables["budget_lines"];
type PendingBudgetLines = {
  Row: BudgetLines["Row"] & { initiative_id: string | null; unit_id: string | null };
  Insert: BudgetLines["Insert"] & { initiative_id?: string | null; unit_id?: string | null };
  Update: BudgetLines["Update"] & { initiative_id?: string | null; unit_id?: string | null };
  Relationships: [
    ...BudgetLines["Relationships"],
    {
      foreignKeyName: "budget_lines_initiative_scope_fk";
      columns: ["initiative_id", "org_id", "workspace_id"];
      isOneToOne: false;
      referencedRelation: "growth_initiatives";
      referencedColumns: ["id", "org_id", "workspace_id"];
    },
  ];
};

type ConvertPlan = GeneratedFunctions["convert_execution_plan"];
type PendingFunctions = {
  set_growth_opportunity_status: {
    Args: { _opportunity: string; _status: string };
    Returns: string;
  };
  convert_growth_opportunity: { Args: { _opportunity: string }; Returns: Json };
  convert_execution_plan: {
    Args: ConvertPlan["Args"] & { _goal?: string | null };
    Returns: ConvertPlan["Returns"];
  };
  create_growth_initiative_work: { Args: { _initiative: string }; Returns: Json };
  update_growth_initiative_operations: {
    Args: { _initiative: string; _patch: Json };
    Returns: Json;
  };
  create_growth_plan_draft: { Args: { _strategy: string }; Returns: Json };
  approve_growth_plan: { Args: { _plan: string }; Returns: Json };
  set_execution_settings: {
    Args: { _workspace: string; _mode: number; _max_per_run: number; _monthly_cap: number };
    Returns: Json;
  };
  assign_task_specialist: {
    Args: { _task: string; _specialist: string; _type: string; _requires_approval: boolean };
    Returns: Json;
  };
  queue_task_run: { Args: { _task: string; _request: string; _estimate: number }; Returns: Json };
  decide_task_run: {
    Args: { _run: string; _decision: "approved" | "rejected"; _note: string };
    Returns: Json;
  };
  control_task_run: {
    Args: { _run: string; _action: "pause" | "resume" | "cancel" };
    Returns: Json;
  };
  reconcile_task_runs: { Args: { _workspace: string }; Returns: number };
  set_execution_governance: { Args: { _workspace: string; _g: Json }; Returns: Json };
  set_execution_paused: {
    Args: { _workspace: string; _paused: boolean; _reason: string };
    Returns: Json;
  };
  plan_execution_cycle: {
    Args: {
      _workspace: string;
      _request: string;
      _trigger: "manual" | "scheduled";
      _estimate: number;
    };
    Returns: Json;
  };
  finish_execution_cycle: { Args: { _cycle: string }; Returns: Json };
  execution_cycle_due: { Args: { _workspace: string }; Returns: Json };
  task_priority_score: { Args: { _task: string }; Returns: number };
  task_open_dependencies: { Args: { _task: string }; Returns: number };
  start_task_run_verified: { Args: { _run: string; _proof: string }; Returns: Json };
  link_task_run_request_verified: {
    Args: { _run: string; _request: string; _proof: string };
    Returns: undefined;
  };
  finish_task_run_verified: {
    Args: { _run: string; _output: Json | null; _error: string; _proof: string };
    Returns: Json;
  };
  decide_growth_plan: {
    Args: {
      _plan: string;
      _decision: "approved" | "rejected" | "changes_requested";
      _note: string;
    };
    Returns: Json;
  };
  create_growth_strategy_project: { Args: { _selected: Json; _strategy: string }; Returns: Json };
  define_metric: {
    Args: {
      _workspace: string;
      _key: string;
      _label: string;
      _unit: string;
      _currency: string | null;
      _direction: string;
      _goal: string | null;
      _initiative: string | null;
    };
    Returns: Json;
  };
  update_metric_definition: { Args: { _metric: string; _patch: Json }; Returns: Json };
  import_measurement_verified: {
    Args: {
      _metric: string;
      _connector: string;
      _period_start: string;
      _period_end: string;
      _value: number;
      _source_ref: string;
      _request: string;
      _proof: string;
    };
    Returns: Json;
  };
  store_connector_credential_verified: {
    Args: {
      _workspace: string;
      _connector: string;
      _secret: string;
      _scopes: string[];
      _expires: string | null;
      _account_label: string | null;
      _config: Json;
      _proof: string;
    };
    Returns: Json;
  };
  read_connector_credential_verified: {
    Args: { _workspace: string; _connector: string; _proof: string };
    Returns: Json;
  };
  report_connector_health_verified: {
    Args: {
      _workspace: string;
      _connector: string;
      _status: string;
      _error: string | null;
      _proof: string;
    };
    Returns: undefined;
  };
  disconnect_connector_verified: {
    Args: { _workspace: string; _connector: string; _proof: string };
    Returns: undefined;
  };
  begin_connector_import_verified: {
    Args: {
      _workspace: string;
      _connector: string;
      _request: string;
      _months: number;
      _proof: string;
    };
    Returns: Json;
  };
  finish_connector_import_verified: {
    Args: {
      _run: string;
      _status: string;
      _created: number;
      _corrected: number;
      _unchanged: number;
      _skipped: number;
      _error: string | null;
      _proof: string;
    };
    Returns: undefined;
  };
  connect_simulated_integration: {
    Args: { _workspace: string; _provider: string; _levels: string[]; _scenario: string };
    Returns: Json;
  };
  set_integration_levels: { Args: { _connection: string; _levels: string[] }; Returns: Json };
  set_simulated_integration_health: {
    Args: { _connection: string; _status: string };
    Returns: undefined;
  };
  revoke_simulated_integration: { Args: { _connection: string }; Returns: undefined };
  create_external_action: {
    Args: {
      _workspace: string;
      _request: string;
      _task: string;
      _connection: string;
      _specialist: string;
      _type: string;
      _title: string;
      _description: string;
      _payload: Json;
      _cost: number | null;
      _currency: string | null;
    };
    Returns: Json;
  };
  submit_external_action: { Args: { _action: string }; Returns: Json };
  decide_external_action: {
    Args: { _action: string; _approve: boolean; _note: string };
    Returns: Json;
  };
  cancel_external_action: { Args: { _action: string }; Returns: Json };
  mark_stalled_external_action: { Args: { _action: string }; Returns: Json };
  external_action_blocker: { Args: { _action: string }; Returns: string | null };
  begin_external_action_verified: {
    Args: { _action: string; _key: string; _proof: string };
    Returns: Json;
  };
  finish_external_action_verified: {
    Args: {
      _action: string;
      _key: string;
      _outcome: string;
      _ref: string | null;
      _error: string | null;
      _health: string | null;
      _proof: string;
    };
    Returns: Json;
  };
  record_external_verification_verified: {
    Args: {
      _action: string;
      _status: string;
      _found: boolean;
      _ref: string | null;
      _evidence: Json;
      _proof: string;
    };
    Returns: Json;
  };
  sim_provider_write_verified: {
    Args: {
      _connection: string;
      _key: string;
      _type: string;
      _state: string;
      _payload: Json;
      _proof: string;
    };
    Returns: Json;
  };
  sim_provider_lookup_verified: {
    Args: { _connection: string; _key: string; _proof: string };
    Returns: Json;
  };
  import_official_rates_verified: {
    Args: { _org: string; _date: string; _rates: { currency: string; rate: string }[]; _proof: string };
    Returns: number;
  };
  set_business_currency: { Args: { _workspace: string; _currency: string }; Returns: string };
  record_exchange_rate: {
    Args: { _org: string; _base: string; _quote: string; _rate: number; _date: string; _source: string };
    Returns: string;
  };
  record_org_opportunity: { Args: { _org: string; _p: Json }; Returns: Json };
  set_org_opportunity_status: { Args: { _id: string; _status: string; _note: string }; Returns: Json };
  propose_org_initiative: { Args: { _org: string; _request: string; _p: Json }; Returns: Json };
  decide_org_commitment: { Args: { _id: string; _approve: boolean; _note: string }; Returns: Json };
  set_org_initiative_status: { Args: { _id: string; _status: string }; Returns: Json };
  propose_org_allocation: { Args: { _org: string; _request: string; _kind: string; _title: string; _reasoning: string; _payload: Json }; Returns: Json };
  decide_org_allocation: { Args: { _id: string; _decision: "apply" | "reject" | "withdraw"; _note: string }; Returns: Json };
  org_credit_overview: { Args: { _org: string; _month: string }; Returns: Json };
  move_budget: { Args: { _from: string; _to: string; _amount: number; _seen_from: number; _seen_to: number }; Returns: Json };
  resolve_fact_conflict: { Args: { _keep: string; _others: string[]; _note: string }; Returns: Json };
  mark_fact_conflict: { Args: { _workspace: string; _topic: string; _kind: "review_started" | "reopened"; _note: string }; Returns: string };
  decide_recommendation: {
    Args: { _workspace: string; _key: string; _decision: "postponed" | "dismissed" | "restored"; _until: string | null; _fingerprint: string; _note: string };
    Returns: string;
  };
  record_business_check: {
    Args: { _workspace: string; _kind: BusinessCheckRow["kind"]; _subject: string | null; _inspected: Json; _findings: Json };
    Returns: Json;
  };
  propose_task_replan: { Args: { _workspace: string; _request: string; _task: string; _p: Json }; Returns: Json };
  decide_task_replan: {
    Args: { _proposal: string; _decision: TaskReplanDecisionRow["decision"]; _option: string | null; _due: string | null; _note: string };
    Returns: Json;
  };
  record_campaign_spend: { Args: { _workspace: string; _request: string; _campaign: string; _p: Json }; Returns: Json };
  set_business_check_frequency: { Args: { _workspace: string; _frequency: BusinessCheckSettingsRow["frequency"] }; Returns: undefined };
  decide_org_strategy: { Args: { _id: string; _decision: "approve" | "reject" | "retire"; _note: string }; Returns: Json };
  begin_org_ai_request_verified: { Args: { _org: string; _workspace: string; _request: string; _input: Json; _proof: string }; Returns: Json };
  finish_org_strategy_verified: { Args: { _id: string; _reply: string; _strategy: Json; _proof: string }; Returns: Json };
  set_specialist_allocation: {
    Args: { _workspace: string; _specialist: string; _enabled: boolean; _priority: number; _cap: number | null };
    Returns: Json;
  };
  /** Proposal 0067 adds the editor role, which the generated enum does not know yet. */
  create_invitation: { Args: { _org: string; _email: string; _role: OrgRoleWithEditor }; Returns: string };
  set_workspace_member: { Args: { _workspace: string; _user: string; _role?: OrgRoleWithEditor }; Returns: undefined };
  create_business_unit: {
    Args: { _workspace: string; _kind: string; _name: string; _parent: string | null };
    Returns: Json;
  };
  record_revenue_event: {
    Args: {
      _workspace: string;
      _request: string;
      _kind: string;
      _amount: number;
      _currency: string;
      _occurred: string;
      _class: string;
      _source_ref: string;
      _customer_ref: string;
      _deal: string | null;
      _relates: string | null;
      _unit: string | null;
      _note: string;
    };
    Returns: Json;
  };
  import_revenue_event_verified: {
    Args: {
      _workspace: string;
      _connector: string;
      _request: string;
      _kind: string;
      _amount: number;
      _currency: string;
      _occurred: string;
      _source_ref: string;
      _customer_ref: string;
      _relates_ref: string | null;
      _proof: string;
    };
    Returns: Json;
  };
  record_touchpoint: {
    Args: {
      _sale: string;
      _request: string;
      _campaign: string | null;
      _initiative: string | null;
      _channel: string;
      _touched: string;
    };
    Returns: Json;
  };
  retract_touchpoint: { Args: { _touchpoint: string }; Returns: Json };
  propose_experiment: { Args: { _workspace: string; _request: string; _p: Json }; Returns: Json };
  design_experiment: { Args: { _workspace: string; _request: string; _p: Json }; Returns: Json };
  revise_experiment_design: { Args: { _experiment: string; _version: number; _p: Json }; Returns: Json };
  move_experiment: { Args: { _experiment: string; _action: string; _data: Json }; Returns: Json };
  record_experiment_observation: { Args: { _experiment: string; _request: string; _p: Json }; Returns: Json };
  advance_experiment: {
    Args: {
      _experiment: string;
      _action: "approve" | "reject" | "start" | "complete" | "cancel";
      _data: Json;
    };
    Returns: Json;
  };
  create_optimization_proposal: {
    Args: { _workspace: string; _request: string; _p: Json };
    Returns: Json;
  };
  advance_optimization_proposal: {
    Args: {
      _proposal: string;
      _action: "review" | "promote" | "approve" | "reject" | "convert" | "measure" | "withdraw";
      _data: Json;
    };
    Returns: Json;
  };
  record_evidence: { Args: { _workspace: string; _request: string; _p: Json }; Returns: Json };
  advance_evidence: {
    Args: { _evidence: string; _action: "classify" | "review" | "accept" | "reject"; _data: Json };
    Returns: Json;
  };
  revise_evidence: {
    Args: { _evidence: string; _request: string; _p: Json; _reason: string };
    Returns: Json;
  };
  link_proposal_evidence: {
    Args: { _proposal: string; _evidence: string; _role: "supports" | "contradicts" };
    Returns: Json;
  };
  record_measurement: {
    Args: {
      _metric: string;
      _kind: string;
      _period_start: string;
      _period_end: string;
      _value: number;
      _note: string;
      _source_ref: string;
      _request: string;
      _corrects: string | null;
    };
    Returns: Json;
  };
};

export type PendingDatabase = Omit<Database, "public"> & {
  public: Omit<Public, "Tables" | "Functions"> & {
    Tables: Omit<GeneratedTables, "budget_lines" | "growth_goals" | "campaigns" | "business_profiles" | "organization_members" | keyof PendingTables> &
      PendingTables & {
        budget_lines: PendingBudgetLines;
        growth_goals: UnitLinked<GeneratedTables["growth_goals"]>;
        campaigns: UnitLinked<GeneratedTables["campaigns"]>;
        business_profiles: PendingBusinessProfiles;
        organization_members: PendingOrgMembers;
      };
    Functions: Omit<GeneratedFunctions, keyof PendingFunctions> & PendingFunctions;
  };
};

// Compile-time only: the same browser client (RLS as the signed-in user), typed with the repository schema.
export const growthDb = supabase as unknown as SupabaseClient<PendingDatabase>;

/** PostgREST/Postgres codes for "this table, column or function is not installed in the connected database". */
const NOT_INSTALLED_CODES = new Set([
  "PGRST205",
  "PGRST204",
  "PGRST202",
  "42P01",
  "42703",
  "42883",
]);
export function isNotInstalled(error: unknown): boolean {
  const code =
    typeof error === "object" && error !== null ? (error as { code?: unknown }).code : undefined;
  return typeof code === "string" && NOT_INSTALLED_CODES.has(code);
}
/** Query retry policy: a missing table will not appear by retrying, so stop immediately; other failures retry up to 3 times. */
export const retryUnlessNotInstalled = (failureCount: number, error: unknown) =>
  !isNotInstalled(error) && failureCount < 3;
export const GROWTH_PLANS_NOT_INSTALLED =
  "Growth Plans are not switched on for this workspace yet. Goals, budget, strategies and work keep working as usual.";
export const CONNECTORS_NOT_INSTALLED =
  "Read-only data connections are not switched on for this workspace yet. Nothing is imported until they are.";
export const OPPORTUNITIES_NOT_INSTALLED =
  "Growth opportunities are not switched on for this workspace yet.";
export const INTEGRATION_HUB_NOT_INSTALLED =
  "The Integration Hub and external actions are not switched on for this workspace yet.";
export const BI_NOT_INSTALLED =
  "Business performance intelligence is not switched on for this workspace yet.";
export const PERFORMANCE_NOT_INSTALLED =
  "Performance tracking is not switched on for this workspace yet. Goals, budget and work keep working as usual.";
