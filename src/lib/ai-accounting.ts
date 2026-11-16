/** Inference finished, but its accounting transaction was not confirmed. Never refund or replay it blindly. */
export class AIOutcomeUnknownError extends Error {
  constructor(public readonly diagnosticIds: Record<string, string> = {}) { super("The AI service outcome is uncertain. Credits remain reserved; inspect saved work before another request."); }
}
export class AINotStartedError extends Error {}
export class AISettlementPendingError extends Error {
  constructor() { super("AI usage could not be finalized. Its reservation is retained for reconciliation; do not resend the request."); }
}
export function mayCloseFailedCoordination(error: unknown) {
  return !(error instanceof AISettlementPendingError) && !(error instanceof AIOutcomeUnknownError);
}