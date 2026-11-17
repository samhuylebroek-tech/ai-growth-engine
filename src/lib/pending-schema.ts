import type { SupabaseClient } from "@supabase/supabase-js";
import { supabase } from "@/integrations/supabase/client";
import type { Database, Json } from "@/integrations/supabase/types";

/**
 * Schema added by committed-but-not-yet-applied migrations 0043_atomic_growth_strategy_conversion and 0046–0052
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

type PendingTables = {
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
};

export type PendingDatabase = Omit<Database, "public"> & {
  public: Omit<Public, "Tables" | "Functions"> & {
    Tables: Omit<GeneratedTables, "budget_lines" | keyof PendingTables> & PendingTables & { budget_lines: PendingBudgetLines };
    Functions: Omit<GeneratedFunctions, keyof PendingFunctions> & PendingFunctions;
  };
};

// Compile-time only: the same browser client (RLS as the signed-in user), typed with the repository schema.
export const growthDb = supabase as unknown as SupabaseClient<PendingDatabase>;
