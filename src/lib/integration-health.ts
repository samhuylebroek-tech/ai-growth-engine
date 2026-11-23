// Integration health and external-action overview, shared by the Integration Hub, Home and the Growth Officer's
// problem list. Pure: callers pass rows read under their own RLS. It reports what records show; it never guesses.
export type HealthConnection = {
  id: string;
  connector_key: string;
  status: string;
  granted_levels: readonly string[];
  last_sync_at: string | null;
  last_error: string | null;
  expires_at: string | null;
  simulated: boolean;
};
export type HealthAction = {
  id: string;
  title: string;
  stage: string;
  verification: string;
  connection_id: string;
  task_id: string;
  goal_id: string | null;
  plan_version_id: string | null;
  required_level: string;
  estimated_cost: number | null;
  currency: string | null;
};
export type Freshness = "never" | "fresh" | "stale" | "old";
export type ProblemKind =
  | "expired"
  | "permission_missing"
  | "sync_error"
  | "disconnected"
  | "level_missing"
  | "failed_actions"
  | "uncertain_actions";
export type Problem = {
  kind: ProblemKind;
  connectionId: string;
  connector: string;
  simulated: boolean;
  actions: string[];
  tasks: string[];
  goals: string[];
  plans: string[];
};
export type Overview = {
  connections: {
    connected: number;
    disconnected: number;
    expired: number;
    permission: number;
    syncErrors: number;
    stale: number;
  };
  actions: {
    inReview: number;
    inProgress: number;
    failed: number;
    uncertain: number;
    awaitingVerification: number;
    verified: number;
    verificationFailed: number;
  };
  /** estimated costs of approved or executed actions, per currency; simulated actions spend nothing */
  estimated: Record<string, { simulated: number; real: number }>;
  problems: Problem[];
};

const DAY = 86_400_000;
export function freshness(lastSync: string | null, now: Date): Freshness {
  if (!lastSync) return "never";
  const age = now.getTime() - new Date(lastSync).getTime();
  return age < DAY ? "fresh" : age < 7 * DAY ? "stale" : "old";
}
export function connectionHealth(
  c: HealthConnection,
  now: Date,
): "connected" | "expired" | "permission_missing" | "sync_error" | "disconnected" {
  if (c.status === "disabled" || c.status === "not_configured") return "disconnected";
  if (c.status === "expired" || (c.expires_at && new Date(c.expires_at).getTime() <= now.getTime()))
    return "expired";
  if (c.status === "insufficient_scope") return "permission_missing";
  if (c.status === "error") return "sync_error";
  return "connected";
}

const OPEN = ["draft", "in_review", "approved", "executing", "failed", "uncertain"];
export function integrationOverview(
  connections: readonly HealthConnection[],
  actions: readonly HealthAction[],
  now: Date,
): Overview {
  const o: Overview = {
    connections: {
      connected: 0,
      disconnected: 0,
      expired: 0,
      permission: 0,
      syncErrors: 0,
      stale: 0,
    },
    actions: {
      inReview: 0,
      inProgress: 0,
      failed: 0,
      uncertain: 0,
      awaitingVerification: 0,
      verified: 0,
      verificationFailed: 0,
    },
    estimated: {},
    problems: [],
  };
  const byConn = new Map<string, HealthAction[]>();
  for (const a of actions) {
    const l = byConn.get(a.connection_id) ?? [];
    l.push(a);
    byConn.set(a.connection_id, l);
  }
  const problem = (kind: ProblemKind, c: HealthConnection, list: HealthAction[]) =>
    o.problems.push({
      kind,
      connectionId: c.id,
      connector: c.connector_key,
      simulated: c.simulated,
      actions: list.map((a) => a.id),
      tasks: [...new Set(list.map((a) => a.task_id))],
      goals: [...new Set(list.flatMap((a) => (a.goal_id ? [a.goal_id] : [])))],
      plans: [...new Set(list.flatMap((a) => (a.plan_version_id ? [a.plan_version_id] : [])))],
    });
  // A source that was never connected is not a disconnection unless work points at it.
  for (const c of connections.filter((x) => x.status !== "not_configured" || byConn.has(x.id))) {
    const h = connectionHealth(c, now);
    const open = (byConn.get(c.id) ?? []).filter((a) => OPEN.includes(a.stage));
    if (h === "connected") {
      o.connections.connected++;
      if (freshness(c.last_sync_at, now) === "old" || freshness(c.last_sync_at, now) === "never")
        o.connections.stale++;
    } else if (h === "disconnected") o.connections.disconnected++;
    else if (h === "expired") o.connections.expired++;
    else if (h === "permission_missing") o.connections.permission++;
    else o.connections.syncErrors++;
    // A disconnected integration only matters when work still depends on it.
    if (h !== "connected" && (h !== "disconnected" || open.length)) problem(h, c, open);
    if (h === "connected") {
      const missing = open.filter((a) => !c.granted_levels.includes(a.required_level));
      if (missing.length) problem("level_missing", c, missing);
    }
    const failed = (byConn.get(c.id) ?? []).filter((a) => a.stage === "failed");
    if (failed.length) problem("failed_actions", c, failed);
    const uncertain = (byConn.get(c.id) ?? []).filter((a) => a.stage === "uncertain");
    if (uncertain.length) problem("uncertain_actions", c, uncertain);
  }
  const sim = new Map(connections.map((c) => [c.id, c.simulated]));
  for (const a of actions) {
    if (a.stage === "in_review") o.actions.inReview++;
    if (a.stage === "approved" || a.stage === "executing") o.actions.inProgress++;
    if (a.stage === "failed") o.actions.failed++;
    if (a.stage === "uncertain") o.actions.uncertain++;
    if (
      a.stage === "executed" &&
      (a.verification === "pending" || a.verification === "not_verified")
    )
      o.actions.awaitingVerification++;
    if (a.stage === "executed" && a.verification === "verified") o.actions.verified++;
    if (a.stage === "executed" && a.verification === "failed") o.actions.verificationFailed++;
    if (
      a.estimated_cost != null &&
      a.currency &&
      ["approved", "executing", "executed"].includes(a.stage)
    ) {
      const e = (o.estimated[a.currency] ??= { simulated: 0, real: 0 });
      if (sim.get(a.connection_id) ?? true) e.simulated += Number(a.estimated_cost);
      else e.real += Number(a.estimated_cost);
    }
  }
  const order: ProblemKind[] = [
    "uncertain_actions",
    "expired",
    "permission_missing",
    "level_missing",
    "sync_error",
    "failed_actions",
    "disconnected",
  ];
  o.problems.sort(
    (a, b) => order.indexOf(a.kind) - order.indexOf(b.kind) || b.actions.length - a.actions.length,
  );
  return o;
}

/** The lifecycle position of an action, for the step indicator. */
export const STEPS = [
  "recommendation",
  "draft",
  "review",
  "approval",
  "execution",
  "verification",
  "result",
] as const;
export type Step = (typeof STEPS)[number];
export function lifecycleStep(a: { stage: string; verification: string }): {
  step: Step;
  state: "done" | "current" | "blocked";
} {
  switch (a.stage) {
    case "draft":
      return { step: "draft", state: "current" };
    case "in_review":
      return { step: "approval", state: "current" };
    case "rejected":
    case "cancelled":
      return { step: "approval", state: "blocked" };
    case "approved":
      return { step: "execution", state: "current" };
    case "executing":
      return { step: "execution", state: "current" };
    case "failed":
      return { step: "execution", state: "blocked" };
    case "uncertain":
      return { step: "verification", state: "current" };
    case "executed":
      if (a.verification === "verified") return { step: "result", state: "done" };
      if (a.verification === "failed") return { step: "verification", state: "blocked" };
      return { step: "verification", state: "current" };
    default:
      return { step: "draft", state: "current" };
  }
}
