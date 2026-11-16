import { expect, it } from "vitest";
import { AISettlementPendingError, AIOutcomeUnknownError, AINotStartedError, mayCloseFailedCoordination, boundedDiagnosticIds, isConfirmedDispatchDenial } from "@/lib/ai-accounting";
it("does not release completed inference reservations after unconfirmed settlement", () => {
  expect(mayCloseFailedCoordination(new AISettlementPendingError())).toBe(false);
  expect(mayCloseFailedCoordination(new Error("Provider rejected before completion"))).toBe(true);
});
it("never closes or refunds an ambiguous remote outcome", () => {
  expect(mayCloseFailedCoordination(new AIOutcomeUnknownError())).toBe(false);
});
it("permits closing a confirmed unstarted request", () => {
  expect(mayCloseFailedCoordination(new AINotStartedError("Rejected"))).toBe(true);
});
it("preserves allowlisted correlation IDs without private provider payloads", () => {
  const error = new AIOutcomeUnknownError({ requestId: "req-test", logId: "log-test", message: "private text", authorization: "credential" });
  expect(error.diagnosticIds).toEqual({ requestId: "req-test", logId: "log-test" });
  expect(mayCloseFailedCoordination(error)).toBe(false);
});
it("bounds diagnostic storage and rejects malformed identifiers", () => {
  expect(boundedDiagnosticIds({ requestId: "x".repeat(301), runId: 42, jobId: "", providerRequestId: "x".repeat(300) })).toEqual({ providerRequestId: "x".repeat(300) });
});
it("recognizes confirmed pre-dispatch denial without treating replay or transport failure as refundable", () => {
  expect(isConfirmedDispatchDenial("Another AI dispatch is unresolved; recover saved work before dispatch")).toBe(true);
  expect(isConfirmedDispatchDenial("Request is closed or expired; recover before dispatch")).toBe(true);
  expect(isConfirmedDispatchDenial("AI dispatch already claimed; never replay")).toBe(false);
  expect(isConfirmedDispatchDenial("Failed to fetch")).toBe(false);
});