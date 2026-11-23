// Staging-only concurrency check for proposal 0084: two sessions try to allocate the same unallocated budget at the
// same moment. Exactly one may succeed; the other must see the first and be refused. Uses (and keeps) one QA budget
// line "qa_concurrency" in the QA business; nothing is deleted. Acts as the QA Admin through the same function the app
// uses, so authorization and locking are exercised exactly as in production.
import { randomUUID } from "node:crypto";
import type { TransactionSql } from "postgres";
import { connectStaging } from "./db";

const a = await connectStaging();
const b = await connectStaging();
const admin = (
  await a.sql`select id from auth.users where email = 'qa-admin@staging.example.com'`
)[0]?.id as string;
const [ws] =
  await a.sql`select w.id, w.org_id from public.workspaces w join public.organizations o on o.id = w.org_id where o.name = 'Staging Bakery' and w.name = 'Main workspace'`;
const camps =
  await a.sql`select id, title from public.campaigns where workspace_id = ${ws.id} and status not in ('completed','cancelled','archived') order by created_at limit 2`;
if (!admin || !ws || camps.length < 2) throw new Error("QA fixture missing");
const month = new Date().toISOString().slice(0, 8) + "01";
const asAdmin = async (tx: TransactionSql) => {
  await tx`select set_config('request.jwt.claims', ${JSON.stringify({ sub: admin, role: "authenticated" })}, true)`;
  await tx`set local role authenticated`;
};

// one QA line per run, planned 100 EUR
const lineId = await a.sql.begin(async (tx) => {
  await asAdmin(tx);
  const [l] =
    await tx`insert into public.budget_lines(org_id, workspace_id, channel, period_month, planned, currency, note, created_by)
    values (${ws.org_id}, ${ws.id}, 'qa_concurrency', ${month}, 100, 'EUR', 'QA 8.8 concurrency test (staging)', ${admin}) returning id`;
  return l.id as string;
});

const attempt = (conn: typeof a, campaign: string, holdMs: number) =>
  conn.sql.begin(async (tx) => {
    await asAdmin(tx);
    const [r] =
      await tx`select public.change_campaign_allocation(${ws.id}, ${randomUUID()}, ${tx.json({ kind: "set", budget_line_id: lineId, campaign_id: campaign, amount: 60, seen_amount: 0, reason: "QA 8.8 concurrency test (staging)" })}) as r`;
    if (holdMs) await tx`select pg_sleep(${holdMs / 1000})`; // keep the line locked while the other session arrives
    return r.r as { status: string; code?: string };
  });

const t0 = Date.now();
const [r1, r2] = await Promise.all([
  attempt(a, camps[0]!.id, 1500),
  new Promise((res) => setTimeout(res, 200)).then(() => attempt(b, camps[1]!.id, 0)),
]);
const waited = Date.now() - t0;
const [sum] =
  await a.sql`select coalesce(sum(amount),0)::numeric as allocated, (select planned from public.budget_lines where id = ${lineId}) as planned from public.campaign_budget_allocations where budget_line_id = ${lineId} and status = 'active'`;
const [ev] =
  await a.sql`select count(*) filter (where outcome='applied')::int as applied, count(*) filter (where outcome='rejected')::int as rejected from public.budget_allocation_events where budget_line_id = ${lineId}`;
await a.sql.end();
await b.sql.end();
const ok =
  [r1.status, r2.status].sort().join() === "applied,rejected" &&
  r2.code === "exceeds_unallocated" &&
  Number(sum.allocated) === 60 &&
  ev.applied === 1 &&
  ev.rejected === 1 &&
  waited >= 1500;
console.log(
  JSON.stringify({
    result: ok ? "PASS" : "FAIL",
    first: r1,
    second: r2,
    secondWaitedForLockMs: waited,
    allocated: Number(sum.allocated),
    planned: Number(sum.planned),
    events: ev,
    line: lineId,
  }),
);
