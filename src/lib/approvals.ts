// Approval lifecycle. SQL function public.decide_approval enforces pending -> approved|rejected.
export type ApprovalStatus = "pending" | "approved" | "rejected" | "executed" | "failed" | "expired";

const TRANSITIONS: Record<ApprovalStatus, ApprovalStatus[]> = {
  pending: ["approved", "rejected", "expired"],
  approved: ["executed", "failed"],
  rejected: [], executed: [], failed: [], expired: [],
};

export function canTransition(from: ApprovalStatus, to: ApprovalStatus): boolean {
  return TRANSITIONS[from].includes(to);
}

export function isTerminal(s: ApprovalStatus): boolean {
  return TRANSITIONS[s].length === 0;
}
