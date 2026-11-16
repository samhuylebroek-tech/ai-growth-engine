import { expect, it } from "vitest";
import { AISettlementPendingError, AIOutcomeUnknownError, AINotStartedError, mayCloseFailedCoordination } from "@/lib/ai-accounting";
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