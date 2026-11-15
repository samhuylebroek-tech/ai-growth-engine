export function growthDraftKey(orgId: string, workspaceId: string): string {
  return `ago.question.${orgId}.${workspaceId}`;
}

export function consumeGrowthDraft(storage: Pick<Storage, "getItem" | "removeItem">, orgId: string, workspaceId: string): string {
  const key = growthDraftKey(orgId, workspaceId);
  const draft = storage.getItem(key) ?? "";
  storage.removeItem(key);
  return draft;
}