// Opens a connection to the verified staging database only. Strips inherited PG* variables first,
// because those point at the production database in this sandbox.
import { resolveStagingTarget, STAGING_REF } from "./target";

for (const k of Object.keys(process.env)) if (/^PG[A-Z]+$/.test(k)) delete process.env[k];

export async function connectStaging(opts: { allowUnmarked?: boolean } = {}) {
  const target = resolveStagingTarget(process.env);
  const { default: postgres } = await import("postgres");
  const sql = postgres(target.url, { ssl: "require", max: 1, prepare: false, onnotice: () => {}, connect_timeout: 20 });
  const [who] = await sql`select current_user as u, current_database() as d`;
  if (who.d !== "postgres") throw new Error("unexpected database");
  // In-database identity marker (outside the public API schema). Created once, on an empty database only.
  const [m] = await sql`select to_regclass('ops_staging.identity') is not null as has`;
  if (m.has) {
    const rows = await sql`select ref from ops_staging.identity`;
    if (rows.length !== 1 || rows[0].ref !== STAGING_REF) throw new Error("in-database identity marker mismatch");
  } else if (!opts.allowUnmarked) {
    throw new Error("in-database identity marker missing; run preflight first");
  }
  return { sql, target, hasMarker: m.has as boolean };
}
