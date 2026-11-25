import { executionSelectionSchema, type ExecutionRef } from "@/lib/execution-context";

export function growthDraftKey(orgId: string, workspaceId: string): string {
  return `ago.question.${orgId}.${workspaceId}`;
}

export function consumeGrowthDraft(
  storage: Pick<Storage, "getItem" | "removeItem">,
  orgId: string,
  workspaceId: string,
): string {
  const key = growthDraftKey(orgId, workspaceId);
  const draft = storage.getItem(key) ?? "";
  storage.removeItem(key);
  return draft;
}

/** Explicit references only; existing server readers still refetch and authorize each record on send. */
export function storeGrowthContext(
  storage: Pick<Storage, "setItem" | "removeItem">,
  orgId: string,
  workspaceId: string,
  refs: readonly ExecutionRef[],
  question: string,
) {
  const parsed = executionSelectionSchema.safeParse(refs);
  const key = `${growthDraftKey(orgId, workspaceId)}.records`;
  if (!parsed.success || !parsed.data.length) {
    storage.removeItem(key);
    return;
  }
  storage.setItem(key, JSON.stringify({ refs: parsed.data, question }));
}

export function consumeGrowthContext(
  storage: Pick<Storage, "getItem" | "removeItem">,
  orgId: string,
  workspaceId: string,
  question: string,
): ExecutionRef[] {
  const key = `${growthDraftKey(orgId, workspaceId)}.records`;
  const raw = storage.getItem(key);
  storage.removeItem(key);
  if (!raw) return [];
  try {
    const envelope: unknown = JSON.parse(raw);
    if (
      !envelope ||
      typeof envelope !== "object" ||
      !("question" in envelope) ||
      envelope.question !== question ||
      !("refs" in envelope)
    )
      return [];
    const parsed = executionSelectionSchema.safeParse(envelope.refs);
    return parsed.success ? parsed.data : [];
  } catch {
    return [];
  }
}
