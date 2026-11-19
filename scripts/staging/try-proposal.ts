// Runs a proposed (not yet journaled) migration plus its assertions on staging inside ONE transaction
// that always rolls back, so staging's schema and ledger stay exactly as the journal describes.
// Usage: bun scripts/staging/try-proposal.ts docs/proposals/<name>.sql tests/proposals/<name>.test.sql
import { readFileSync } from "node:fs";
import { connectStaging } from "./db";

const [proposal, assertions] = process.argv.slice(2);
if (!proposal || !assertions) throw new Error("usage: try-proposal.ts <proposal.sql> <assertions.sql>");
const { sql } = await connectStaging();
let detail = "";
try {
  await sql.begin(async (tx) => {
    await tx.unsafe(readFileSync(proposal, "utf8"));
    await tx.unsafe(readFileSync(assertions, "utf8"));
    throw new Error("__no_result_raised");
  });
} catch (e) { detail = String((e as Error).message ?? e).replace(/\s+/g, " ").slice(0, 300); }
const [after] = await sql`select to_regprocedure('public.import_measurement_verified(uuid,text,date,date,numeric,text,uuid,text)') is not null as persisted`;
await sql.end();
const ok = /_RESULT pass=\d+ fail=0\b/.test(detail);
console.log(`${ok ? "PASS" : "FAIL"} ${proposal} ${detail}`);
console.log(JSON.stringify({ rolledBack: true, proposalFunctionPersisted: after.persisted }));
