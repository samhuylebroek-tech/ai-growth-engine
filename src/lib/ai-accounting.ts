/** Inference finished, but its accounting transaction was not confirmed. Never refund or replay it blindly. */
export class AISettlementPendingError extends Error {
  constructor() { super("AI usage could not be finalized. Its reservation is retained for reconciliation; do not resend the request."); }
}
export function mayCloseFailedCoordination(error: unknown) {
  return !(error instanceof AISettlementPendingError);
}