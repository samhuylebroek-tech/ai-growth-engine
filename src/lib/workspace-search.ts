import { z } from "zod";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/integrations/supabase/types";
export const searchTermSchema = z.string().trim().min(2).max(100);
export type WorkspaceSearchHit = {
  id: string;
  kind: "projects" | "tasks" | "campaigns" | "documents" | "business_facts" | "conversations";
  title: string;
};
export function literalSearchPattern(term: string) {
  return `%${searchTermSchema.parse(term).replace(/[\\%_]/g, "\\$&")}%`;
}
/** Bounded, workspace-scoped search; conversations remain private to the caller. */
export async function searchWorkspace(
  sb: SupabaseClient<Database>,
  scope: { orgId: string; workspaceId: string; userId: string },
  term: string,
): Promise<WorkspaceSearchHit[]> {
  const pattern = literalSearchPattern(term);
  const sources = [
    "projects",
    "tasks",
    "campaigns",
    "documents",
    "business_facts",
    "conversations",
  ] as const;
  const results = await Promise.all(
    sources.map(async (kind) => {
      const field = kind === "documents" ? "name" : kind === "business_facts" ? "key" : "title";
      const query =
        kind === "conversations"
          ? sb
              .from("conversations")
              .select("id,title")
              .eq("org_id", scope.orgId)
              .eq("workspace_id", scope.workspaceId)
              .eq("user_id", scope.userId)
              .ilike("title", pattern)
              .order("created_at", { ascending: false })
              .order("id")
              .limit(5)
          : sb
              .from(kind)
              .select(`id,${field}`)
              .eq("org_id", scope.orgId)
              .eq("workspace_id", scope.workspaceId)
              .ilike(field, pattern)
              .order("created_at", { ascending: false })
              .order("id")
              .limit(5);
      const response = await query;
      if (response.error) throw new Error("Workspace search could not finish");
      return (response.data ?? []).map((row) => {
        const parsed = z
          .object({
            id: z.string(),
            title: z.string().optional(),
            name: z.string().optional(),
            key: z.string().optional(),
          })
          .parse(row);
        return { id: parsed.id, kind, title: parsed.title ?? parsed.name ?? parsed.key ?? "" };
      });
    }),
  );
  return results.flat();
}
