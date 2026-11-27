// Runtime environment guard. Pure, so every rule is unit tested.
// A staging runtime must point only at the confirmed staging project; any doubt refuses to serve.
// When APP_ENVIRONMENT is not set (the platform preview and live app) nothing is changed.
export const STAGING_REF = "tvfbvzytjpizqwixkecx";
export const PRODUCTION_REF = "tbngginnzutpprzvovvc";
export const STAGING_URL = `https://${STAGING_REF}.supabase.co`;

export type AppEnvironment = "staging" | "production" | "unspecified";
export type EnvironmentCheck = { environment: AppEnvironment; problems: string[] };

/** Names only, never values: problems are safe to log and show. */
export function checkRuntimeEnvironment(env: Record<string, string | undefined>): EnvironmentCheck {
  const raw = env["APP_ENVIRONMENT"]?.trim();
  if (!raw) return { environment: "unspecified", problems: [] };
  if (raw !== "staging" && raw !== "production")
    return { environment: "unspecified", problems: ["APP_ENVIRONMENT has an unknown value"] };
  const problems: string[] = [];
  const url = env["SUPABASE_URL"]?.replace(/\/+$/, "");
  const key = env["SUPABASE_PUBLISHABLE_KEY"];
  if (!url) problems.push("SUPABASE_URL is missing");
  if (!key) problems.push("SUPABASE_PUBLISHABLE_KEY is missing");
  if (!env["AI_ACCOUNTING_SECRET"]) problems.push("AI_ACCOUNTING_SECRET is missing");
  const browserEnv = env["VITE_APP_ENVIRONMENT"];
  if (browserEnv && browserEnv !== raw)
    problems.push("VITE_APP_ENVIRONMENT differs from APP_ENVIRONMENT");
  if (raw === "staging") {
    if (url && url !== STAGING_URL) problems.push("SUPABASE_URL is not the staging project");
    for (const k of ["SUPABASE_PROJECT_ID", "VITE_SUPABASE_PROJECT_ID"])
      if (env[k] && env[k] !== STAGING_REF) problems.push(`${k} is not the staging project`);
    if (env["VITE_SUPABASE_URL"] && env["VITE_SUPABASE_URL"].replace(/\/+$/, "") !== STAGING_URL)
      problems.push("VITE_SUPABASE_URL is not the staging project");
    // A staging runtime never needs a service-role key; one present here can only be borrowed from elsewhere.
    if (env["SUPABASE_SERVICE_ROLE_KEY"])
      problems.push("SUPABASE_SERVICE_ROLE_KEY must not be present in staging");
    for (const [k, v] of Object.entries(env))
      if (v && v.includes(PRODUCTION_REF)) problems.push(`${k} references the production project`);
  } else {
    for (const [k, v] of Object.entries(env))
      if (v && v.includes(STAGING_REF)) problems.push(`${k} references the staging project`);
  }
  return { environment: raw, problems: [...new Set(problems)] };
}

/** Browser-visible environment label, from the build-time value only. */
export function browserEnvironment(value: string | undefined): AppEnvironment {
  return value === "staging" ? "staging" : value === "production" ? "production" : "unspecified";
}
