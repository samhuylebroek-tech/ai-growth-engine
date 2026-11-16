import { expect, it } from "vitest";
import { AISettlementPendingError, mayCloseFailedCoordination } from "@/lib/ai-accounting";
it("does not release completed inference reservations after unconfirmed settlement", () => {
  expect(mayCloseFailedCoordination(new AISettlementPendingError())).toBe(false);
  expect(mayCloseFailedCoordination(new Error("Provider rejected before completion"))).toBe(true);
});