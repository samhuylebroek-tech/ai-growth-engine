import { describe, expect, it } from "vitest";
import {
  checkRuntimeEnvironment,
  PRODUCTION_REF,
  STAGING_REF,
  STAGING_URL,
} from "@/lib/environment";

const staging = {
  APP_ENVIRONMENT: "staging",
  VITE_APP_ENVIRONMENT: "staging",
  SUPABASE_URL: STAGING_URL,
  VITE_SUPABASE_URL: STAGING_URL,
  SUPABASE_PUBLISHABLE_KEY: "sb_publishable_x",
  SUPABASE_PROJECT_ID: STAGING_REF,
  AI_ACCOUNTING_SECRET: "s".repeat(40),
};

describe("runtime environment guard", () => {
  it("changes nothing when no environment is declared (preview and live)", () => {
    expect(
      checkRuntimeEnvironment({ SUPABASE_URL: `https://${PRODUCTION_REF}.supabase.co` }),
    ).toEqual({ environment: "unspecified", problems: [] });
  });
  it("accepts a clean staging configuration", () => {
    expect(checkRuntimeEnvironment(staging).problems).toEqual([]);
  });
  it("refuses staging pointed at another backend", () => {
    expect(
      checkRuntimeEnvironment({ ...staging, SUPABASE_URL: `https://${PRODUCTION_REF}.supabase.co` })
        .problems,
    ).toContain("SUPABASE_URL is not the staging project");
  });
  it("refuses staging when any value mentions the production project", () => {
    expect(
      checkRuntimeEnvironment({
        ...staging,
        EXTRA: `postgres://x@db.${PRODUCTION_REF}.supabase.co`,
      }).problems,
    ).toContain("EXTRA references the production project");
  });
  it("refuses a service-role key in staging", () => {
    expect(
      checkRuntimeEnvironment({ ...staging, SUPABASE_SERVICE_ROLE_KEY: "k" }).problems,
    ).toContain("SUPABASE_SERVICE_ROLE_KEY must not be present in staging");
  });
  it("refuses missing secrets and mixed browser/server labels", () => {
    const p = checkRuntimeEnvironment({
      ...staging,
      AI_ACCOUNTING_SECRET: undefined,
      SUPABASE_PUBLISHABLE_KEY: undefined,
      VITE_APP_ENVIRONMENT: "production",
    }).problems;
    expect(p).toEqual(
      expect.arrayContaining([
        "AI_ACCOUNTING_SECRET is missing",
        "SUPABASE_PUBLISHABLE_KEY is missing",
        "VITE_APP_ENVIRONMENT differs from APP_ENVIRONMENT",
      ]),
    );
  });
  it("refuses production that references staging, and unknown labels", () => {
    expect(
      checkRuntimeEnvironment({
        APP_ENVIRONMENT: "production",
        SUPABASE_URL: STAGING_URL,
        SUPABASE_PUBLISHABLE_KEY: "k",
        AI_ACCOUNTING_SECRET: "s",
      }).problems,
    ).toContain("SUPABASE_URL references the staging project");
    expect(checkRuntimeEnvironment({ APP_ENVIRONMENT: "stage" }).problems).toEqual([
      "APP_ENVIRONMENT has an unknown value",
    ]);
  });
  it("never puts a secret value into a problem message", () => {
    const secret = "sb_secret_DO_NOT_LEAK";
    const p = checkRuntimeEnvironment({
      ...staging,
      SUPABASE_SERVICE_ROLE_KEY: secret,
      X: `${PRODUCTION_REF}${secret}`,
    }).problems.join(" ");
    expect(p).not.toContain(secret);
  });
});
