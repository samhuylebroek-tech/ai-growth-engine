// Builds the environment for the sandbox-only staging app. Pure, so it can be unit tested.
// Allowlist only: production database URLs, the production service-role key, PG* variables and
// the platform sandbox markers are never passed on.
import { PRODUCTION_REF, STAGING_REF } from "./target";

export const STAGING_URL = `https://${STAGING_REF}.supabase.co`;
const PASS_THROUGH = ["PATH", "HOME", "USER", "TMPDIR", "LANG", "NODE_PATH", "NODE_EXTRA_CA_CERTS", "SSL_CERT_FILE", "NIX_SSL_CERT_FILE", "NIX_LD", "NIX_LD_LIBRARY_PATH", "LD_LIBRARY_PATH", "LOVABLE_API_KEY"];
const SECRET_SHAPED = /(SERVICE_ROLE|DB_URL|DATABASE_URL|MIGRATION_URL|^PG[A-Z]+$|^SUPABASE_|^VITE_|^EXPO_PUBLIC_|^LOVABLE_SANDBOX$|^DEV_SERVER)/;

export class StagingAppEnvError extends Error {}

export function stagingAppEnv(env: Record<string, string | undefined>): Record<string, string> {
  const key = env["STAGING_SUPABASE_PUBLISHABLE_KEY"];
  const proof = env["STAGING_AI_ACCOUNTING_SECRET"];
  if (!key) throw new StagingAppEnvError("STAGING_SUPABASE_PUBLISHABLE_KEY is not set");
  if (!proof) throw new StagingAppEnvError("STAGING_AI_ACCOUNTING_SECRET is not set");
  for (const k of ["VITE_SUPABASE_PUBLISHABLE_KEY", "SUPABASE_PUBLISHABLE_KEY", "VITE_SUPABASE_ANON_KEY"]) {
    if (env[k] && env[k] === key) throw new StagingAppEnvError(`staging key equals the live ${k}`);
  }
  if (env["AI_ACCOUNTING_SECRET"] && env["AI_ACCOUNTING_SECRET"] === proof) throw new StagingAppEnvError("staging accounting secret equals the live one");
  const out: Record<string, string> = {};
  for (const k of PASS_THROUGH) { const v = env[k]; if (v && !SECRET_SHAPED.test(k)) out[k] = v; }
  Object.assign(out, {
    NODE_ENV: "development",
    APP_ENVIRONMENT: "staging",
    VITE_APP_ENVIRONMENT: "staging",
    VITE_SUPABASE_URL: STAGING_URL, SUPABASE_URL: STAGING_URL,
    VITE_SUPABASE_PUBLISHABLE_KEY: key, SUPABASE_PUBLISHABLE_KEY: key, VITE_SUPABASE_ANON_KEY: key,
    VITE_SUPABASE_PROJECT_ID: STAGING_REF, SUPABASE_PROJECT_ID: STAGING_REF,
    AI_ACCOUNTING_SECRET: proof,
  });
  if (Object.values(out).some(v => v.includes(PRODUCTION_REF))) throw new StagingAppEnvError("staging app environment references the production project");
  return out;
}
