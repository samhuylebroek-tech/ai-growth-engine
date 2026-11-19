// Applies one reviewed schema proposal (docs/proposals/*.sql) to STAGING ONLY and records it in
// ops_staging.applied_proposals (name + SHA-256). Proposals are idempotent, so the later official
// migration can run on staging again. The live database is never touched (connectStaging guard).
// Usage: bun scripts/staging/apply-proposal.ts docs/proposals/<name>.sql
import { readFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { basename } from "node:path";
import { connectStaging } from "./db";

const file = process.argv[2];
if (!file || !/^docs\/proposals\/\d{4}_[a-z0-9_]+\.sql$/.test(file)) throw new Error("usage: apply-proposal.ts docs/proposals/<NNNN_name>.sql");
const body = readFileSync(file, "utf8");
if (!body.startsWith("-- PROPOSED migration")) throw new Error("not a proposal file");
const name = basename(file, ".sql"); const sha = createHash("sha256").update(body).digest("hex");
const { sql } = await connectStaging();
await sql`create table if not exists ops_staging.applied_proposals (name text not null, sha256 text not null, applied_at timestamptz not null default now(), primary key (name, sha256))`;
const [done] = await sql`select 1 from ops_staging.applied_proposals where name = ${name} and sha256 = ${sha}`;
if (done) { console.log(JSON.stringify({ name, status: "already applied" })); await sql.end(); process.exit(0); }
await sql.begin(async (tx) => {
  await tx.unsafe(body);
  await tx`insert into ops_staging.applied_proposals(name, sha256) values (${name}, ${sha})`;
});
const [ledger] = await sql`select count(*)::int as n from drizzle.__drizzle_migrations`;
console.log(JSON.stringify({ name, status: "applied to staging", sha256: sha.slice(0, 12), migrationLedger: ledger.n }));
await sql.end();
