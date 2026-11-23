import { describe, expect, it } from "vitest";
import { simulatedAdapter, type SimBackend } from "@/lib/integrations/simulated";
import {
  freshness,
  integrationOverview,
  lifecycleStep,
  type HealthAction,
  type HealthConnection,
} from "@/lib/integration-health";

function memory() {
  const store = new Map<string, { external_ref: string; state: string }>();
  let writes = 0;
  const b: SimBackend = {
    async write(key, _type, state) {
      const e = store.get(key);
      if (e) return { ...e, existing: true };
      writes++;
      const r = { external_ref: `sim_${key.slice(0, 6)}`, state };
      store.set(key, r);
      return { ...r, existing: false };
    },
    async lookup(key) {
      const e = store.get(key);
      return e ? { found: true, ...e, created_at: "2026-11-20T10:00:00Z" } : { found: false };
    },
  };
  return { b, writes: () => writes };
}

describe("simulated provider adapter", () => {
  it("executes once per key and verifies the expected state", async () => {
    const m = memory();
    const ad = simulatedAdapter(m.b);
    const r1 = await ad.execute({
      key: "key-1",
      type: "crm.create_task",
      payload: {},
      scenario: "success",
    });
    const r2 = await ad.execute({
      key: "key-1",
      type: "crm.create_task",
      payload: {},
      scenario: "success",
    });
    expect(r1).toEqual({ outcome: "executed", ref: "sim_key-1" });
    expect(r2).toEqual(r1);
    expect(m.writes()).toBe(1);
    expect((await ad.verify({ key: "key-1", type: "crm.create_task" })).status).toBe("verified");
  });
  it("reports a timeout as uncertain; verification then finds or rules out the record", async () => {
    const m = memory();
    const ad = simulatedAdapter(m.b);
    expect(
      (
        await ad.execute({
          key: "after",
          type: "content.save_draft",
          payload: {},
          scenario: "timeout_after_write",
        })
      ).outcome,
    ).toBe("uncertain");
    expect(await ad.verify({ key: "after", type: "content.save_draft" })).toMatchObject({
      status: "verified",
      found: true,
    });
    expect(
      (
        await ad.execute({
          key: "before",
          type: "content.save_draft",
          payload: {},
          scenario: "timeout_before_write",
        })
      ).outcome,
    ).toBe("uncertain");
    expect(await ad.verify({ key: "before", type: "content.save_draft" })).toMatchObject({
      status: "failed",
      found: false,
    });
  });
  it("passes provider denials and expiry to the connection's health without writing anything", async () => {
    const m = memory();
    const ad = simulatedAdapter(m.b);
    expect(
      await ad.execute({
        key: "d",
        type: "ads.change_budget",
        payload: {},
        scenario: "permission_denied",
      }),
    ).toMatchObject({ outcome: "failed", health: "insufficient_scope" });
    expect(
      await ad.execute({
        key: "e",
        type: "ads.change_budget",
        payload: {},
        scenario: "token_expired",
      }),
    ).toMatchObject({ outcome: "failed", health: "expired" });
    expect(
      await ad.execute({
        key: "f",
        type: "ads.change_budget",
        payload: {},
        scenario: "provider_error",
      }),
    ).toMatchObject({ outcome: "failed", health: null });
    expect(m.writes()).toBe(0);
  });
  it("does not treat an API success as verified when the provider state differs", async () => {
    const ad = simulatedAdapter(memory().b);
    expect(
      (
        await ad.execute({
          key: "drift",
          type: "content.publish",
          payload: {},
          scenario: "state_drift",
        })
      ).outcome,
    ).toBe("executed");
    expect(await ad.verify({ key: "drift", type: "content.publish" })).toMatchObject({
      status: "failed",
      found: true,
    });
  });
});

const now = new Date("2026-11-20T12:00:00Z");
const conn = (id: string, o: Partial<HealthConnection> = {}): HealthConnection => ({
  id,
  connector_key: "sim.hubspot",
  status: "connected",
  granted_levels: ["read", "execute"],
  last_sync_at: "2026-11-20T08:00:00Z",
  last_error: null,
  expires_at: null,
  simulated: true,
  ...o,
});
const act = (id: string, o: Partial<HealthAction> = {}): HealthAction => ({
  id,
  title: id,
  stage: "approved",
  verification: "not_verified",
  connection_id: "c1",
  task_id: "t1",
  goal_id: "g1",
  plan_version_id: null,
  required_level: "execute",
  estimated_cost: null,
  currency: null,
  ...o,
});

describe("integration health", () => {
  it("names the tasks, goals and plans an expired connection affects", () => {
    const ov = integrationOverview(
      [conn("c1", { status: "expired" })],
      [
        act("a1"),
        act("a2", { task_id: "t2", plan_version_id: "p1" }),
        act("a3", { stage: "executed", verification: "verified" }),
      ],
      now,
    );
    const p = ov.problems.find((x) => x.kind === "expired")!;
    expect(p.actions).toEqual(["a1", "a2"]);
    expect(p.tasks).toEqual(["t1", "t2"]);
    expect(p.goals).toEqual(["g1"]);
    expect(p.plans).toEqual(["p1"]);
    expect(ov.connections.expired).toBe(1);
  });
  it("flags open actions whose required permission is not granted", () => {
    const ov = integrationOverview([conn("c1", { granted_levels: ["read"] })], [act("a1")], now);
    expect(ov.problems.map((p) => p.kind)).toEqual(["level_missing"]);
  });
  it("ignores a disconnected integration nothing depends on, but not one with open work", () => {
    expect(integrationOverview([conn("c1", { status: "disabled" })], [], now).problems).toEqual([]);
    expect(
      integrationOverview([conn("c1", { status: "disabled" })], [act("a1")], now).problems.map(
        (p) => p.kind,
      ),
    ).toEqual(["disconnected"]);
  });
  it("lists uncertain actions first and counts each stage", () => {
    const ov = integrationOverview(
      [conn("c1")],
      [
        act("a1", { stage: "failed" }),
        act("a2", { stage: "uncertain" }),
        act("a3", { stage: "in_review" }),
        act("a4", { stage: "executed", verification: "pending" }),
        act("a5", { stage: "executed", verification: "verified" }),
      ],
      now,
    );
    expect(ov.problems[0]!.kind).toBe("uncertain_actions");
    expect(ov.actions).toEqual({
      inReview: 1,
      inProgress: 0,
      failed: 1,
      uncertain: 1,
      awaitingVerification: 1,
      verified: 1,
      verificationFailed: 0,
    });
  });
  it("keeps estimated costs per currency and separates simulated from real", () => {
    const ov = integrationOverview(
      [conn("c1"), conn("c2", { simulated: false, connector_key: "hubspot" })],
      [
        act("a1", { estimated_cost: 20, currency: "EUR" }),
        act("a2", { estimated_cost: 5, currency: "USD", stage: "executed" }),
        act("a3", { connection_id: "c2", estimated_cost: 7, currency: "EUR", stage: "approved" }),
        act("a4", { estimated_cost: 99, currency: "EUR", stage: "draft" }),
      ],
      now,
    );
    expect(ov.estimated).toEqual({
      EUR: { simulated: 20, real: 7 },
      USD: { simulated: 5, real: 0 },
    });
  });
  it("treats an expiry time in the past as expired and grades data freshness", () => {
    expect(
      integrationOverview([conn("c1", { expires_at: "2026-11-20T11:00:00Z" })], [], now).connections
        .expired,
    ).toBe(1);
    expect(freshness(null, now)).toBe("never");
    expect(freshness("2026-11-20T08:00:00Z", now)).toBe("fresh");
    expect(freshness("2026-11-17T08:00:00Z", now)).toBe("stale");
    expect(freshness("2026-11-01T08:00:00Z", now)).toBe("old");
  });
  it("places each stage on the lifecycle", () => {
    expect(lifecycleStep({ stage: "in_review", verification: "not_verified" })).toEqual({
      step: "approval",
      state: "current",
    });
    expect(lifecycleStep({ stage: "uncertain", verification: "pending" })).toEqual({
      step: "verification",
      state: "current",
    });
    expect(lifecycleStep({ stage: "executed", verification: "verified" })).toEqual({
      step: "result",
      state: "done",
    });
    expect(lifecycleStep({ stage: "executed", verification: "failed" })).toEqual({
      step: "verification",
      state: "blocked",
    });
  });
});
