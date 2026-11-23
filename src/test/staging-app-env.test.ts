import { describe, it, expect } from "vitest";
import { stagingAppEnv, STAGING_URL } from "../../scripts/staging/app-env";

const base = {
  PATH: "/bin",
  HOME: "/root",
  LOVABLE_API_KEY: "gw",
  STAGING_SUPABASE_PUBLISHABLE_KEY: "sb_publishable_staging",
  STAGING_AI_ACCOUNTING_SECRET: "staging-proof",
  VITE_SUPABASE_URL: "https://tbngginnzutpprzvovvc.supabase.co",
  VITE_SUPABASE_PUBLISHABLE_KEY: "sb_publishable_live",
  SUPABASE_SERVICE_ROLE_KEY: "live-service",
  SUPABASE_DB_URL: "postgres://live",
  PGPASSWORD: "x",
  AI_ACCOUNTING_SECRET: "live-proof",
  STAGING_DB_MIGRATION_URL: "postgres://staging",
  LOVABLE_SANDBOX: "1",
  DEV_SERVER__PROJECT_PATH: "/dev-server",
};

describe("staging app environment", () => {
  it("points the browser and server at the staging project with staging credentials", () => {
    const e = stagingAppEnv(base);
    expect(e["VITE_SUPABASE_URL"]).toBe("https://tvfbvzytjpizqwixkecx.supabase.co");
    expect(e["SUPABASE_URL"]).toBe(STAGING_URL);
    expect(e["VITE_SUPABASE_PUBLISHABLE_KEY"]).toBe("sb_publishable_staging");
    expect(e["AI_ACCOUNTING_SECRET"]).toBe("staging-proof");
  });
  it("never passes on the live service key, database URLs, PG settings or sandbox markers", () => {
    const e = stagingAppEnv(base);
    for (const k of [
      "SUPABASE_SERVICE_ROLE_KEY",
      "SUPABASE_DB_URL",
      "PGPASSWORD",
      "STAGING_DB_MIGRATION_URL",
      "LOVABLE_SANDBOX",
      "DEV_SERVER__PROJECT_PATH",
      "STAGING_SUPABASE_PUBLISHABLE_KEY",
    ])
      expect(e[k]).toBeUndefined();
    expect(Object.values(e).join(" ")).not.toContain("tbngginnzutpprzvovvc");
  });
  it("refuses a staging key or accounting secret that equals the live one", () => {
    expect(() =>
      stagingAppEnv({ ...base, STAGING_SUPABASE_PUBLISHABLE_KEY: "sb_publishable_live" }),
    ).toThrow(/equals the live/);
    expect(() => stagingAppEnv({ ...base, STAGING_AI_ACCOUNTING_SECRET: "live-proof" })).toThrow(
      /equals the live/,
    );
    expect(() => stagingAppEnv({ ...base, STAGING_SUPABASE_PUBLISHABLE_KEY: undefined })).toThrow(
      /not set/,
    );
  });
});
