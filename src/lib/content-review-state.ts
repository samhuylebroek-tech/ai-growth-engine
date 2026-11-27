type Draft = { title: string; draft_body: string };
type Version = { title: string; body: string };
/** Approval never migrates from a recorded version to changed draft material. */
export function contentReviewState(
  draft: Draft,
  version: Version | null,
  decision: string | null | undefined,
) {
  if (!version || version.body !== draft.draft_body || version.title !== draft.title)
    return "draft";
  if (decision === "approved" || decision === "rejected") return decision;
  return "awaiting";
}
