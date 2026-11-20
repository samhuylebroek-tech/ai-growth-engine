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

type PlanRow = { approved_at: string | null; approved_by: string | null; created_at: string; created_by: string; goal_id: string; id: string; org_id: string; plan_snapshot: Json; strategic_thesis: string; status: string; strategy_id: string; summary: string; title: string; version: number; workspace_id: string };
export type ExecutionSettingsRow = { workspace_id: string; org_id: string; mode: number; max_credits_per_run: number; monthly_credit_cap: number; updated_by: string | null; updated_at: string;
  paused: boolean; pause_reason: string | null; paused_by: string | null; paused_at: string | null; daily_credit_cap: number | null; max_parallel: number; max_attempts: number;
  allowed_specialists: string[]; window_start: number | null; window_end: number | null; timezone: string; schedule: "off" | "daily" | "weekdays"; schedule_hour: number };
export type ExecutionCycleRow = { id: string; org_id: string; workspace_id: string; request_key: string; trigger: "manual" | "scheduled"; reason: string; status: "open" | "completed" | "stopped";
  stop_reason: "paused" | "expired" | "finished_early" | null; limits: Json; queued: number; awaiting: number; skipped: number; summary: Json | null; started_by: string; created_at: string; finished_at: string | null };
export type ExecutionCycleItemRow = { cycle_id: string; org_id: string; workspace_id: string; task_id: string; rank: number; score: number; decision: "queued" | "awaiting_approval" | "skipped"; reason: string; run_id: string | null };
export type TaskProfileRow = { task_id: string; org_id: string; workspace_id: string; specialist_key: string; task_type: "analysis" | "preparation" | "external"; requires_approval: boolean; assigned_by: string; assigned_at: string };
export type TaskRunRow = { id: string; org_id: string; workspace_id: string; task_id: string; request_key: string; specialist_key: string; task_type: "analysis" | "preparation"; mode: number; attempt: number;
  status: "awaiting_approval" | "queued" | "paused" | "running" | "succeeded" | "failed" | "uncertain" | "cancelled" | "rejected"; estimated_credits: number; credits_charged: number | null;
  single_request_id: string | null; agent_run_id: string | null; output: Json | null; error: string | null; decision_note: string | null; decided_by: string | null; lease_until: string | null;
  requested_by: string; created_at: string; started_at: string | null; finished_at: string | null; updated_at: string; cycle_id: string | null };
export type PlanDecisionRow = { id: string; org_id: string; workspace_id: string; plan_version_id: string; decision: "approved" | "rejected" | "changes_requested"; note: string; decided_by: string; decided_at: string };
type InitiativeRow = { project_id: string | null; channel: string; created_at: string; detail: string; effort: string; goal_id: string; id: string; org_id: string; plan_version_id: string; sort_order: number; status: string; target_week: number; title: string; workspace_id: string };
type OperationRow = { initiative_id: string; org_id: string; workspace_id: string; owner_id: string | null; due_date: string | null; success_metric: string; baseline_value: number | null; target_value: number | null; current_value: number | null; blocker_note: string; updated_by: string; updated_at: string };

type MetricRow = { id: string; org_id: string; workspace_id: string; key: string; label: string; unit: string; currency: string | null; direction: string; goal_id: string | null; initiative_id: string | null; archived: boolean; created_by: string; created_at: string; updated_at: string };
type MeasurementRow = { id: string; org_id: string; workspace_id: string; metric_id: string; period_start: string; period_end: string; kind: string; value: number; source: string; source_ref: string; note: string; request_key: string; corrects_id: string | null; created_by: string; created_at: string };

type ConnectionRow = GeneratedTables["connector_connections"]["Row"] & { account_label: string | null; scopes: string[]; expires_at: string | null; last_checked_at: string | null; last_sync_at: string | null; last_error: string | null };
type ImportRunRow = { id: string; org_id: string; workspace_id: string; connector_key: string; request_key: string; months: number; status: string; created_count: number; corrected_count: number; unchanged_count: number; skipped_count: number; error: string | null; started_by: string; started_at: string; finished_at: string | null };

export type OpportunityRow = { id: string; org_id: string; workspace_id: string; request_key: string; position: number; domain: string; title: string; summary: string; analysis: string; audience: string; expected_impact: string; impact: number; feasibility: number; cost: number; time_to_value: number; risk: number; complexity: string; budget_min: number | null; budget_max: number | null; currency: string; horizon_days: number; resources: string[]; integrations: string[]; risks: string[]; kpis: Json; evidence: Json; confidence: string; status: string; goal_id: string | null; decided_by: string | null; decided_at: string | null; created_by: string; created_at: string };

type PendingTables = {
  growth_opportunities: { Row: OpportunityRow; Insert: Partial<OpportunityRow>; Update: never; Relationships: [] };
  connector_connections: { Row: ConnectionRow; Insert: Partial<ConnectionRow>; Update: Partial<ConnectionRow>; Relationships: GeneratedTables["connector_connections"]["Relationships"] };
  connector_import_runs: { Row: ImportRunRow; Insert: Partial<ImportRunRow>; Update: Partial<ImportRunRow>; Relationships: [] };
  metric_definitions: {
    Row: MetricRow;
    Insert: Partial<MetricRow>;
    Update: Partial<MetricRow>;
    Relationships: [
      { foreignKeyName: "metric_definitions_goal_id_org_id_workspace_id_fkey"; columns: ["goal_id", "org_id", "workspace_id"]; isOneToOne: false; referencedRelation: "growth_goals"; referencedColumns: ["id", "org_id", "workspace_id"] },
    ];
  };
  performance_measurements: {
    Row: MeasurementRow;
    Insert: Partial<MeasurementRow>;
    Update: Partial<MeasurementRow>;
    Relationships: [
      { foreignKeyName: "performance_measurements_metric_id_org_id_workspace_id_fkey"; columns: ["metric_id", "org_id", "workspace_id"]; isOneToOne: false; referencedRelation: "metric_definitions"; referencedColumns: ["id", "org_id", "workspace_id"] },
    ];
  };
  growth_plan_versions: {
    Row: PlanRow;
    Insert: Partial<PlanRow> & Pick<PlanRow, "goal_id" | "org_id" | "plan_snapshot" | "strategy_id" | "summary" | "title" | "version" | "workspace_id">;
    Update: Partial<PlanRow>;
    Relationships: [
      { foreignKeyName: "growth_plan_versions_goal_id_org_id_workspace_id_fkey"; columns: ["goal_id", "org_id", "workspace_id"]; isOneToOne: false; referencedRelation: "growth_goals"; referencedColumns: ["id", "org_id", "workspace_id"] },
    ];
  };
  growth_initiatives: {
    Row: InitiativeRow;
    Insert: Partial<InitiativeRow> & Pick<InitiativeRow, "goal_id" | "org_id" | "plan_version_id" | "sort_order" | "title" | "workspace_id">;
    Update: Partial<InitiativeRow>;
    Relationships: [
      { foreignKeyName: "growth_initiatives_plan_version_id_org_id_workspace_id_fkey"; columns: ["plan_version_id", "org_id", "workspace_id"]; isOneToOne: false; referencedRelation: "growth_plan_versions"; referencedColumns: ["id", "org_id", "workspace_id"] },
      { foreignKeyName: "growth_initiatives_project_scope_fk"; columns: ["project_id", "org_id", "workspace_id"]; isOneToOne: true; referencedRelation: "projects"; referencedColumns: ["id", "org_id", "workspace_id"] },
    ];
  };
  growth_plan_decisions: { Row: PlanDecisionRow; Insert: never; Update: never; Relationships: [] };
  execution_settings: { Row: ExecutionSettingsRow; Insert: never; Update: never; Relationships: [] };
  task_execution_profiles: { Row: TaskProfileRow; Insert: never; Update: never; Relationships: [] };
  task_runs: { Row: TaskRunRow; Insert: never; Update: never; Relationships: [] };
  execution_cycles: { Row: ExecutionCycleRow; Insert: never; Update: never; Relationships: [] };
  execution_cycle_items: { Row: ExecutionCycleItemRow; Insert: never; Update: never; Relationships: [] };
  growth_initiative_operations: {
    Row: OperationRow;
    Insert: Partial<OperationRow> & Pick<OperationRow, "initiative_id" | "org_id" | "workspace_id">;
    Update: Partial<OperationRow>;
    Relationships: [
      { foreignKeyName: "growth_initiative_operations_initiative_id_org_id_workspace_id_fkey"; columns: ["initiative_id", "org_id", "workspace_id"]; isOneToOne: true; referencedRelation: "growth_initiatives"; referencedColumns: ["id", "org_id", "workspace_id"] },
    ];
  };
};

type BudgetLines = GeneratedTables["budget_lines"];
type PendingBudgetLines = {
  Row: BudgetLines["Row"] & { initiative_id: string | null };
  Insert: BudgetLines["Insert"] & { initiative_id?: string | null };
  Update: BudgetLines["Update"] & { initiative_id?: string | null };
  Relationships: [...BudgetLines["Relationships"], { foreignKeyName: "budget_lines_initiative_scope_fk"; columns: ["initiative_id", "org_id", "workspace_id"]; isOneToOne: false; referencedRelation: "growth_initiatives"; referencedColumns: ["id", "org_id", "workspace_id"] }];
};

type ConvertPlan = GeneratedFunctions["convert_execution_plan"];
type PendingFunctions = {
  set_growth_opportunity_status: { Args: { _opportunity: string; _status: string }; Returns: string };
  convert_growth_opportunity: { Args: { _opportunity: string }; Returns: Json };
  convert_execution_plan: { Args: ConvertPlan["Args"] & { _goal?: string | null }; Returns: ConvertPlan["Returns"] };
  create_growth_initiative_work: { Args: { _initiative: string }; Returns: Json };
  update_growth_initiative_operations: { Args: { _initiative: string; _patch: Json }; Returns: Json };
  create_growth_plan_draft: { Args: { _strategy: string }; Returns: Json };
  approve_growth_plan: { Args: { _plan: string }; Returns: Json };
  set_execution_settings: { Args: { _workspace: string; _mode: number; _max_per_run: number; _monthly_cap: number }; Returns: Json };
  assign_task_specialist: { Args: { _task: string; _specialist: string; _type: string; _requires_approval: boolean }; Returns: Json };
  queue_task_run: { Args: { _task: string; _request: string; _estimate: number }; Returns: Json };
  decide_task_run: { Args: { _run: string; _decision: "approved" | "rejected"; _note: string }; Returns: Json };
  control_task_run: { Args: { _run: string; _action: "pause" | "resume" | "cancel" }; Returns: Json };
  reconcile_task_runs: { Args: { _workspace: string }; Returns: number };
  set_execution_governance: { Args: { _workspace: string; _g: Json }; Returns: Json };
  set_execution_paused: { Args: { _workspace: string; _paused: boolean; _reason: string }; Returns: Json };
  plan_execution_cycle: { Args: { _workspace: string; _request: string; _trigger: "manual" | "scheduled"; _estimate: number }; Returns: Json };
  finish_execution_cycle: { Args: { _cycle: string }; Returns: Json };
  execution_cycle_due: { Args: { _workspace: string }; Returns: Json };
  task_priority_score: { Args: { _task: string }; Returns: number };
  task_open_dependencies: { Args: { _task: string }; Returns: number };
  start_task_run_verified: { Args: { _run: string; _proof: string }; Returns: Json };
  link_task_run_request_verified: { Args: { _run: string; _request: string; _proof: string }; Returns: undefined };
  finish_task_run_verified: { Args: { _run: string; _output: Json | null; _error: string; _proof: string }; Returns: Json };
  decide_growth_plan: { Args: { _plan: string; _decision: "approved" | "rejected" | "changes_requested"; _note: string }; Returns: Json };
  create_growth_strategy_project: { Args: { _selected: Json; _strategy: string }; Returns: Json };
  define_metric: { Args: { _workspace: string; _key: string; _label: string; _unit: string; _currency: string | null; _direction: string; _goal: string | null; _initiative: string | null }; Returns: Json };
  update_metric_definition: { Args: { _metric: string; _patch: Json }; Returns: Json };
  import_measurement_verified: { Args: { _metric: string; _connector: string; _period_start: string; _period_end: string; _value: number; _source_ref: string; _request: string; _proof: string }; Returns: Json };
  store_connector_credential_verified: { Args: { _workspace: string; _connector: string; _secret: string; _scopes: string[]; _expires: string | null; _account_label: string | null; _config: Json; _proof: string }; Returns: Json };
  read_connector_credential_verified: { Args: { _workspace: string; _connector: string; _proof: string }; Returns: Json };
  report_connector_health_verified: { Args: { _workspace: string; _connector: string; _status: string; _error: string | null; _proof: string }; Returns: undefined };
  disconnect_connector_verified: { Args: { _workspace: string; _connector: string; _proof: string }; Returns: undefined };
  begin_connector_import_verified: { Args: { _workspace: string; _connector: string; _request: string; _months: number; _proof: string }; Returns: Json };
  finish_connector_import_verified: { Args: { _run: string; _status: string; _created: number; _corrected: number; _unchanged: number; _skipped: number; _error: string | null; _proof: string }; Returns: undefined };
  record_measurement: { Args: { _metric: string; _kind: string; _period_start: string; _period_end: string; _value: number; _note: string; _source_ref: string; _request: string; _corrects: string | null }; Returns: Json };
};

export type PendingDatabase = Omit<Database, "public"> & {
  public: Omit<Public, "Tables" | "Functions"> & {
    Tables: Omit<GeneratedTables, "budget_lines" | keyof PendingTables> & PendingTables & { budget_lines: PendingBudgetLines };
    Functions: Omit<GeneratedFunctions, keyof PendingFunctions> & PendingFunctions;
  };
};

// Compile-time only: the same browser client (RLS as the signed-in user), typed with the repository schema.
export const growthDb = supabase as unknown as SupabaseClient<PendingDatabase>;

/** PostgREST/Postgres codes for "this table, column or function is not installed in the connected database". */
const NOT_INSTALLED_CODES = new Set(["PGRST205", "PGRST204", "PGRST202", "42P01", "42703", "42883"]);
export function isNotInstalled(error: unknown): boolean {
  const code = typeof error === "object" && error !== null ? (error as { code?: unknown }).code : undefined;
  return typeof code === "string" && NOT_INSTALLED_CODES.has(code);
}
/** Query retry policy: a missing table will not appear by retrying, so stop immediately; other failures retry up to 3 times. */
export const retryUnlessNotInstalled = (failureCount: number, error: unknown) => !isNotInstalled(error) && failureCount < 3;
export const GROWTH_PLANS_NOT_INSTALLED = "Growth Plans are not switched on for this workspace yet. Goals, budget, strategies and work keep working as usual.";
export const CONNECTORS_NOT_INSTALLED = "Read-only data connections are not switched on for this workspace yet. Nothing is imported until they are.";
export const OPPORTUNITIES_NOT_INSTALLED = "Growth opportunities are not switched on for this workspace yet.";
export const PERFORMANCE_NOT_INSTALLED = "Performance tracking is not switched on for this workspace yet. Goals, budget and work keep working as usual.";
