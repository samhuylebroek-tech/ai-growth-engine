import { z } from "zod";

/** A campaign proposal is stored as one typed execution note on the campaign (kind "proposal", content_type "draft",
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
  return n.kind === "proposal" && n.title === PROPOSAL_TITLE;
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

export const PROPOSAL_TASK_MAX = 12;
const ACTIVITY_HEADING =
  /^#{1,6}\s*.*(activit|actions?|taken|tâches|tasks|planning|plan d'action)/i;
const HEADING = /^#{1,6}\s/;
const ITEM = /^\s*(?:[-*•]|\d+[.)])\s+(?:\[[ x]\]\s+)?(.+)$/;

/** Extracts explicit activities; fallback accepts a plain list, never KPI/risk/budget sections.
 * Pure and deterministic (no AI, no credits); duplicates removed, capped at PROPOSAL_TASK_MAX. */
export function proposalTasks(text: string): string[] {
  const lines = text.split(/\r?\n/);
  const collect = (onlyActivities: boolean) => {
    const out: string[] = [];
    let inside = !onlyActivities;
    let activityLevel = 0;
    for (const line of lines) {
      if (HEADING.test(line)) {
        if (onlyActivities) {
          const level = line.match(/^#+/)?.[0].length ?? 0;
          if (ACTIVITY_HEADING.test(line)) {
            inside = true;
            activityLevel = level;
          } else if (level <= activityLevel) inside = false;
        }
        continue;
      }
      const m = inside ? ITEM.exec(line) : null;
      if (!m?.[1]) continue;
      const title = m[1]
        .replace(/\*\*|__|`/g, "")
        .replace(/^\[(?:fact|calc|estimate|hypothesis|recommendation|missing)\]:?\s*/i, "")
        .replace(/\s+/g, " ")
        .trim()
        .slice(0, 200);
      if (title.length >= 3 && !out.some((o) => o.toLowerCase() === title.toLowerCase()))
        out.push(title);
    }
    return out;
  };
  const found = collect(true);
  return (
    found.length ? found : lines.some((line) => HEADING.test(line)) ? [] : collect(false)
  ).slice(0, PROPOSAL_TASK_MAX);
}

/** Label linking tasks to the exact approved proposal note, used to prevent creating them twice. */
export function proposalTaskLabel(noteId: string): string {
  return `proposal:${noteId}`;
}
