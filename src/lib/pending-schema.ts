import type { SupabaseClient } from "@supabase/supabase-js";
import { supabase } from "@/integrations/supabase/client";
import type { Database, Json } from "@/integrations/supabase/types";

/**
 * Schema added by committed-but-not-yet-applied migrations 0043_atomic_growth_strategy_conversion, 0046–0052 and
 * 0056_performance_measurements
 * (see docs/MIGRATION_POLICY.md). The generated types follow the connected database, which does not have these
 * objects yet, so the growth plan/initiative screens type against this extension. At runtime the database still
 * answers "not found" for these objects until the migrations are applied; screens must keep their error states.
 * Delete this file once the generated types contain these tables.
 */
type Public = Database["public"];
type GeneratedTables = Public["Tables"];
type GeneratedFunctions = Public["Functions"];

type PlanRow = { approved_at: string | null; approved_by: string | null; created_at: string; created_by: string; goal_id: string; id: string; org_id: string; plan_snapshot: Json; strategic_thesis: string; status: string; strategy_id: string; summary: string; title: string; version: number; workspace_id: string };
type InitiativeRow = { project_id: string | null; channel: string; created_at: string; detail: string; effort: string; goal_id: string; id: string; org_id: string; plan_version_id: string; sort_order: number; status: string; target_week: number; title: string; workspace_id: string };
type OperationRow = { initiative_id: string; org_id: string; workspace_id: string; owner_id: string | null; due_date: string | null; success_metric: string; baseline_value: number | null; target_value: number | null; current_value: number | null; blocker_note: string; updated_by: string; updated_at: string };

type MetricRow = { id: string; org_id: string; workspace_id: string; key: string; label: string; unit: string; currency: string | null; direction: string; goal_id: string | null; initiative_id: string | null; archived: boolean; created_by: string; created_at: string; updated_at: string };
type MeasurementRow = { id: string; org_id: string; workspace_id: string; metric_id: string; period_start: string; period_end: string; kind: string; value: number; source: string; source_ref: string; note: string; request_key: string; corrects_id: string | null; created_by: string; created_at: string };

type PendingTables = {
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
  convert_execution_plan: { Args: ConvertPlan["Args"] & { _goal?: string | null }; Returns: ConvertPlan["Returns"] };
  create_growth_initiative_work: { Args: { _initiative: string }; Returns: Json };
  update_growth_initiative_operations: { Args: { _initiative: string; _patch: Json }; Returns: Json };
  create_growth_plan_draft: { Args: { _strategy: string }; Returns: Json };
  approve_growth_plan: { Args: { _plan: string }; Returns: Json };
  create_growth_strategy_project: { Args: { _selected: Json; _strategy: string }; Returns: Json };
  define_metric: { Args: { _workspace: string; _key: string; _label: string; _unit: string; _currency: string | null; _direction: string; _goal: string | null; _initiative: string | null }; Returns: Json };
  update_metric_definition: { Args: { _metric: string; _patch: Json }; Returns: Json };
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
export const PERFORMANCE_NOT_INSTALLED = "Performance tracking is not switched on for this workspace yet. Goals, budget and work keep working as usual.";
