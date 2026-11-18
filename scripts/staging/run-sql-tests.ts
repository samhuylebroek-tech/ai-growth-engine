// Runs every tests/sql suite against the verified staging database. Each suite raises at the end,
// so all of its changes roll back. Afterwards the script confirms no test rows persisted.
import { readdirSync, readFileSync } from "node:fs";
import { connectStaging } from "./db";

const only = process.argv.slice(2);
const { sql } = await connectStaging();
const counts = async () => (await sql`select (select count(*)::int from auth.users) u, (select count(*)::int from public.organizations) o, (select count(*)::int from public.workspaces) w`)[0];
const before = await counts();
const results: { suite: string; outcome: string; detail: string }[] = [];
for (const f of readdirSync("tests/sql").filter((f) => f.endsWith(".sql")).sort()) {
  if (only.length && !only.some((o) => f.includes(o))) continue;
  const body = readFileSync(`tests/sql/${f}`, "utf8");
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
