// Staging-only database target resolution. Pure and side-effect free so it can be unit tested.
// The staging project reference was verified from the Supabase-generated pooler URI on 2026-11-18.
import { STAGING_REF, PRODUCTION_REF } from "../../src/lib/environment";
export { STAGING_REF, PRODUCTION_REF };

export type StagingTarget = { url: string; ref: string; host: string; port: number };

export class StagingTargetError extends Error {}

/** Resolve and validate the staging target. Throws (without echoing the URL) on any doubt. */
export function resolveStagingTarget(env: Record<string, string | undefined>): StagingTarget {
  const raw = env["STAGING_DB_MIGRATION_URL"];
  if (!raw) throw new StagingTargetError("STAGING_DB_MIGRATION_URL is not set");
  if (raw.includes(PRODUCTION_REF))
    throw new StagingTargetError("target references the production project");
  for (const k of ["SUPABASE_DB_URL", "LOVABLE_DB_MIGRATION_URL", "DATABASE_URL"]) {
    if (env[k] && env[k] === raw) throw new StagingTargetError(`target equals ${k}`);
  }
  let u: URL;
  try {
    u = new URL(raw);
  } catch {
    throw new StagingTargetError("target is not a valid URL");
  }
  if (u.protocol !== "postgres:" && u.protocol !== "postgresql:")
    throw new StagingTargetError("target is not a postgres URL");
  const user = decodeURIComponent(u.username);
  const host = u.hostname.toLowerCase();
  let ref: string | null = null;
  if (/^aws-\d+-[a-z0-9-]+\.pooler\.supabase\.com$/.test(host)) {
    const m = /^postgres\.([a-z0-9]{20})$/.exec(user);
    ref = m?.[1] ?? null;
  } else {
    const m = /^db\.([a-z0-9]{20})\.supabase\.co$/.exec(host);
    ref = m && user === "postgres" ? (m[1] ?? null) : null;
  }
  if (!ref) throw new StagingTargetError("cannot derive an unambiguous Supabase project reference");
  if (ref === PRODUCTION_REF) throw new StagingTargetError("target is the production project");
  for (const k of ["SUPABASE_PROJECT_ID", "VITE_SUPABASE_PROJECT_ID"]) {
    if (env[k] && env[k] === ref) throw new StagingTargetError(`target equals the app's ${k}`);
  }
  if (ref !== STAGING_REF)
    throw new StagingTargetError("target is not the verified staging project");
  if ((u.pathname || "/").replace(/^\//, "") !== "postgres")
    throw new StagingTargetError("unexpected database name");
  return { url: raw, ref, host, port: Number(u.port || 5432) };
}
