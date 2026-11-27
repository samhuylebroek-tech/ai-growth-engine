// Orchestrates one read-only import run. Every side effect is injected, so the whole flow is testable;
// the server function supplies role-checked, server-attested database calls and real provider fetchers.
import { ProviderError, type FetchResult, type HealthStatus } from "./providers";
import { completeMonths, importRequestKey, planImports, type TrackedMetric } from "./plan";

export type SyncDeps = {
  beginRun(months: number): Promise<{ runId: string; existing: boolean; status: string }>;
  fetchValues(range: { startDate: string; endDate: string }): Promise<FetchResult>;
  listMetrics(): Promise<TrackedMetric[]>;
  importValue(i: {
    metricId: string;
    periodStart: string;
    periodEnd: string;
    value: number;
    sourceRef: string;
    requestKey: string;
  }): Promise<string>;
  reportHealth(status: "connected" | HealthStatus, error: string | null): Promise<void>;
  finishRun(r: {
    status: "succeeded" | "partial" | "failed";
    created: number;
    corrected: number;
    unchanged: number;
    skipped: number;
    error: string | null;
  }): Promise<void>;
};
export type SyncOutcome = {
  runId: string;
  status: string;
  created: number;
  corrected: number;
  unchanged: number;
  skipped: number;
  untracked: string[];
  mismatched: string[];
  message: string | null;
};

export async function runSync(
  deps: SyncDeps,
  months: number,
  now = new Date(),
): Promise<SyncOutcome> {
  const run = await deps.beginRun(months);
  const empty = {
    created: 0,
    corrected: 0,
    unchanged: 0,
    skipped: 0,
    untracked: [],
    mismatched: [],
  };
  if (run.existing && run.status !== "running")
    return { runId: run.runId, status: run.status, ...empty, message: "This import already ran." };
  const window = completeMonths(now, months);
  const range = { startDate: window[0]!.start, endDate: window.at(-1)!.end };
  let fetched: FetchResult;
  try {
    fetched = await deps.fetchValues(range);
  } catch (e) {
    const err =
      e instanceof ProviderError
        ? e
        : new ProviderError("error", "The data source could not be read.");
    await deps.reportHealth(err.health, err.message);
    await deps.finishRun({
      status: "failed",
      created: 0,
      corrected: 0,
      unchanged: 0,
      skipped: 0,
      error: err.message,
    });
    return { runId: run.runId, status: "failed", ...empty, message: err.message };
  }
  await deps.reportHealth("connected", null);
  const plan = planImports(fetched.values, await deps.listMetrics(), window);
  const c = { created: 0, corrected: 0, unchanged: 0, skipped: 0 };
  const errors: string[] = [];
  for (const i of plan.imports) {
    try {
      const status = await deps.importValue({
        ...i,
        sourceRef: `${i.sourceRef}#run=${run.runId}`,
        requestKey: await importRequestKey(run.runId, i.metricId, i.month),
      });
      if (status === "created") c.created++;
      else if (status === "corrected") c.corrected++;
      else c.unchanged++;
    } catch (e) {
      c.skipped++;
      if (errors.length < 3)
        errors.push(`${i.metricKey} ${i.month}: ${e instanceof Error ? e.message : "rejected"}`);
    }
  }
  const notes = [
    ...errors,
    ...(fetched.truncated
      ? ["The provider returned more data than one import reads; older records may be missing."]
      : []),
    ...(plan.mismatched.length
      ? [`Unit or currency differs for: ${plan.mismatched.join(", ")}`]
      : []),
  ];
  const status = c.skipped || fetched.truncated || plan.mismatched.length ? "partial" : "succeeded";
  await deps.finishRun({
    status,
    ...c,
    error: notes.length ? notes.join(" · ").slice(0, 500) : null,
  });
  return {
    runId: run.runId,
    status,
    ...c,
    untracked: plan.untracked,
    mismatched: plan.mismatched,
    message: notes[0] ?? null,
  };
}
