/** Inference finished, but its accounting transaction was not confirmed. Never refund or replay it blindly. */
const DIAGNOSTIC_KEYS = ["requestId", "logId", "runId", "jobId", "providerRequestId"] as const;
/** Keep correlation identifiers only, never provider messages or arbitrary payloads. */
export function boundedDiagnosticIds(ids: Record<string, unknown>): Record<string, string> {
  return Object.fromEntries(DIAGNOSTIC_KEYS.flatMap(key => {
    const value = ids[key];
    return typeof value === "string" && value.length > 0 && value.length <= 300 ? [[key, value]] : [];
  }));
}
export class AIOutcomeUnknownError extends Error {
  readonly diagnosticIds: Record<string, string>;
  constructor(ids: Record<string, unknown> = {}) {
    super("The AI service outcome is uncertain. Credits remain reserved; inspect saved work before another request.");
    this.diagnosticIds = boundedDiagnosticIds(ids);
  }
}
export class AINotStartedError extends Error {}
/** Only explicit pre-dispatch database denials prove this invocation did not infer. */
export function isConfirmedDispatchDenial(message: string): boolean {
  return ["Another AI dispatch is unresolved; recover saved work before dispatch", "Request is closed or expired; recover before dispatch", "analysis lease expired; recover before any new request", "previous step incomplete", "open reservation required", "forbidden"].includes(message);
}
export class AISettlementPendingError extends Error {
  constructor() { super("AI usage could not be finalized. Its reservation is retained for reconciliation; do not resend the request."); }
}
export function mayCloseFailedCoordination(error: unknown) {
  return !(error instanceof AISettlementPendingError) && !(error instanceof AIOutcomeUnknownError);
}