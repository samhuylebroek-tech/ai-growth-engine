// Runs every tests/sql suite against the verified staging database. Each suite raises at the end,
// so all of its changes roll back. Afterwards the script confirms no test rows persisted.
import { readdirSync, readFileSync } from "node:fs";
import { connectStaging } from "./db";

const only = process.argv.slice(2);
const { sql } = await connectStaging();
const counts = async () => (await sql`select (select count(*)::int from auth.users) u, (select count(*)::int from public.organizations) o, (select count(*)::int from public.workspaces) w`)[0];
const before = await counts();
const results: { suite: string; outcome: string; detail: string }[] = [];
// Suites for schema proposals run only once that proposal is applied to staging (apply-proposal.ts).
const [hasLedger] = await sql`select to_regclass('ops_staging.applied_proposals') is not null as has`;
const applied = new Set(hasLedger.has ? (await sql`select distinct name from ops_staging.applied_proposals`).map((r) => r.name as string) : []);
const files = [
  ...readdirSync("tests/sql").filter((f) => f.endsWith(".sql")).sort().map((f) => `tests/sql/${f}`),
  ...readdirSync("tests/proposals").filter((f) => f.endsWith(".test.sql") && applied.has(f.replace(".test.sql", ""))).sort().map((f) => `tests/proposals/${f}`),
];
for (const path of files) {
  const f = path.replace(/^tests\//, "");
  if (only.length && !only.some((o) => f.includes(o))) continue;
  const body = readFileSync(path, "utf8");
  try {
    await sql.begin(async (tx) => { await tx.unsafe(body); throw new Error("__no_result_raised"); });
    results.push({ suite: f, outcome: "NO RESULT", detail: "" });
  } catch (e) {
    const msg = String((e as Error).message ?? e).replace(/\s+/g, " ").slice(0, 300);
    const ok = /(_RESULT pass=\d+ fail=0\b|_OK\b)/.test(msg) && !/fail=[1-9]/.test(msg);
    results.push({ suite: f, outcome: ok ? "PASS" : "FAIL", detail: msg });
  }
}
const after = await counts();
for (const r of results) console.log(`${r.outcome.padEnd(9)} ${r.suite.padEnd(30)} ${r.detail}`);
console.log(JSON.stringify({ suites: results.length, passed: results.filter((r) => r.outcome === "PASS").length, rowsBefore: before, rowsAfter: after, rolledBack: JSON.stringify(before) === JSON.stringify(after) }));
await sql.end();
