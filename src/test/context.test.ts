import { describe, expect, it } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/integrations/supabase/types";
import { readConversation, readDocument, workspaceContext } from "@/lib/security/context";

const scope = { orgId: "org-a", workspaceId: "ws-a" };
const rows: Record<string, Record<string, unknown>[]> = {
  workspaces: [{ id: "ws-a", org_id: "org-a", name: "A" }, { id: "ws-b", org_id: "org-a", name: "B" }, { id: "ws-c", org_id: "org-b", name: "C" }],
  conversations: [{ id: "conv-a", org_id: "org-a", workspace_id: "ws-a", user_id: "user-a" }, { id: "conv-b", org_id: "org-a", workspace_id: "ws-b", user_id: "user-a" }, { id: "conv-other", org_id: "org-a", workspace_id: "ws-a", user_id: "user-b" }],
  messages: [{ conversation_id: "conv-a", org_id: "org-a", role: "user", content: "memory-a" }, { conversation_id: "conv-b", org_id: "org-a", role: "user", content: "memory-b-secret" }],
  documents: [{ id: "doc-a", org_id: "org-a", workspace_id: "ws-a", storage_path: "org-a/ws-a/a.txt" }, { id: "doc-b", org_id: "org-a", workspace_id: "ws-b", storage_path: "org-a/ws-b/b.txt" }, { id: "doc-bad", org_id: "org-a", workspace_id: "ws-a", storage_path: "org-b/ws-c/secret.txt" }],
  business_profiles: [{ org_id: "org-a", workspace_id: "ws-a", description: "stale-unconfirmed-profile", objectives: ["Grow"], onboarding_completed_at: "2026-11-14" }],
  business_facts: [{ org_id: "org-a", workspace_id: "ws-a", key: "identity", value: "confirmed-a", verified: true }, { org_id: "org-a", workspace_id: "ws-a", value: "unconfirmed-secret", verified: false }, { org_id: "org-a", workspace_id: "ws-b", value: "workspace-b-secret", verified: true }, { org_id: "org-b", workspace_id: "ws-c", value: "org-b-secret", verified: true }],
  approvals: [],
};
// Deliberately no simulated RLS: verifies explicit server query predicates even if a client could see every row.
function client(failTable?: string) {
  return { from(table: string) {
    let selected = rows[table] ?? [];
    const q = {
      select() { return q; }, eq(key: string, value: unknown) { selected = selected.filter(row => row[key] === value); return q; },
      order() { return q; }, limit() { return q; },
      maybeSingle() { return Promise.resolve({ data: selected[0] ?? null, error: table === failTable ? new Error("denied") : null }); },
      then(resolve: (v: unknown) => unknown) { return Promise.resolve({ data: selected, error: table === failTable ? new Error("denied") : null }).then(resolve); },
    }; return q;
  } } as unknown as SupabaseClient<Database>;
}
describe("server context boundaries", () => {
  it("rejects a same-user conversation ID from a different workspace", async () => { await expect(readConversation(client(), scope, "conv-b", "user-a")).rejects.toThrow("Conversation not found"); });
  it("rejects another user's conversation", async () => { await expect(readConversation(client(), scope, "conv-other", "user-a")).rejects.toThrow("Conversation not found"); });
  it("reads only scoped conversation memory", async () => { expect(await readConversation(client(), scope, "conv-a", "user-a")).toEqual([rows["messages"]?.[0]]); });
  it("rejects a manipulated document ID in another workspace", async () => { await expect(readDocument(client(), scope, "doc-b")).rejects.toThrow("Document not found"); });
  it("rejects a mismatched stored object path", async () => { await expect(readDocument(client(), scope, "doc-bad")).rejects.toThrow("Document not found"); });
  it("rejects an organization/workspace mismatch before context reads", async () => { await expect(workspaceContext(client(), { orgId: "org-a", workspaceId: "ws-c" })).rejects.toThrow("Workspace not found"); });
  it("excludes unconfirmed assumptions, profile mirrors and other tenants", async () => {
    const context = await workspaceContext(client(), scope);
    expect(context).toContain("confirmed-a");
    for (const secret of ["unconfirmed-secret", "stale-unconfirmed-profile", "workspace-b-secret", "org-b-secret"]) expect(context).not.toContain(secret);
  });
  it("rebuilds context on workspace switch without retaining the previous facts", async () => {
    const context = await workspaceContext(client(), { orgId: "org-a", workspaceId: "ws-b" });
    expect(context).toContain("workspace-b-secret"); expect(context).not.toContain("confirmed-a");
  });
  it("fails closed when a context read is denied", async () => { await expect(workspaceContext(client("business_facts"), scope)).rejects.toThrow("Could not read"); });
});