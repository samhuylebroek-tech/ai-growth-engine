import { z } from "zod";

/** A campaign proposal is stored as one typed execution note on the campaign (kind "approval", content_type "draft",
 * title PROPOSAL_TITLE) so it reuses the existing parent-scoped, RLS-protected note structure without a new table. */
export const PROPOSAL_TITLE = "campaign-proposal";
export const PROPOSAL_MAX = 20000;
export const proposalStatuses = ["draft", "approved", "rejected"] as const;
export type ProposalStatus = (typeof proposalStatuses)[number];

const bodySchema = z.object({
  v: z.literal(1),
  status: z.enum(proposalStatuses),
  text: z.string().max(PROPOSAL_MAX),
  decidedBy: z.string().nullable(),
  decidedAt: z.string().nullable(),
  note: z.string().max(1000).default(""),
});
export type Proposal = z.infer<typeof bodySchema>;

type NoteLike = {
  kind: string;
  title: string;
  content_type?: string;
  body: string;
  entity_id: string;
};

export function isProposalNote(n: NoteLike): boolean {
  return n.kind === "approval" && n.title === PROPOSAL_TITLE && n.content_type === "draft";
}

export function parseProposal(body: string): Proposal | null {
  try {
    const r = bodySchema.safeParse(JSON.parse(body));
    return r.success ? r.data : null;
  } catch {
    return null;
  }
}

/** Saving text (new or modified) always returns the proposal to draft: an approval covers only the text it saw. */
export function saveDraft(text: string): Proposal {
  const t = text.trim();
  if (!t) throw new Error("empty_proposal");
  if (t.length > PROPOSAL_MAX) throw new Error("proposal_too_long");
  return { v: 1, status: "draft", text: t, decidedBy: null, decidedAt: null, note: "" };
}

/** Only a draft can be decided; a decision never authorises spending, publishing or sending. */
export function decide(
  p: Proposal,
  approve: boolean,
  userId: string,
  at: Date,
  note = "",
): Proposal {
  if (p.status !== "draft") throw new Error("already_decided");
  return {
    ...p,
    status: approve ? "approved" : "rejected",
    decidedBy: userId,
    decidedAt: at.toISOString(),
    note: note.trim().slice(0, 1000),
  };
}

export function serialize(p: Proposal): string {
  return JSON.stringify(p);
}
