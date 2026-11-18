import { describe, expect, it } from "vitest";
import { resolveStagingTarget, STAGING_REF, PRODUCTION_REF } from "../../scripts/staging/target";

const pooler = (ref: string, port = 5432) => `postgresql://postgres.${ref}:pw@aws-0-eu-west-1.pooler.supabase.com:${port}/postgres`;

describe("staging migration target", () => {
  it("accepts the verified staging pooler URL", () => {
    expect(resolveStagingTarget({ STAGING_DB_MIGRATION_URL: pooler(STAGING_REF) }).ref).toBe(STAGING_REF);
  });
  it("accepts the verified staging direct host", () => {
    const url = `postgresql://postgres:pw@db.${STAGING_REF}.supabase.co:5432/postgres`;
    expect(resolveStagingTarget({ STAGING_DB_MIGRATION_URL: url }).ref).toBe(STAGING_REF);
  });
  it("refuses the production project", () => {
    expect(() => resolveStagingTarget({ STAGING_DB_MIGRATION_URL: pooler(PRODUCTION_REF) })).toThrow(/production/);
  });
  it("refuses the misspelled project reference from the original request", () => {
    expect(() => resolveStagingTarget({ STAGING_DB_MIGRATION_URL: pooler("tvfbvzytjzipqzwikxecx".slice(0, 20)) })).toThrow();
  });
  it("refuses a target equal to the app's own database URL", () => {
    const url = pooler(STAGING_REF);
    expect(() => resolveStagingTarget({ STAGING_DB_MIGRATION_URL: url, SUPABASE_DB_URL: url })).toThrow(/SUPABASE_DB_URL/);
  });
  it("refuses when the app itself points at the staging project", () => {
    expect(() => resolveStagingTarget({ STAGING_DB_MIGRATION_URL: pooler(STAGING_REF), VITE_SUPABASE_PROJECT_ID: STAGING_REF })).toThrow();
  });
  it("refuses a missing or non-postgres target", () => {
    expect(() => resolveStagingTarget({})).toThrow(/not set/);
    expect(() => resolveStagingTarget({ STAGING_DB_MIGRATION_URL: "https://example.com" })).toThrow();
  });
  it("never includes the connection string in errors", () => {
    try {
      resolveStagingTarget({ STAGING_DB_MIGRATION_URL: pooler(PRODUCTION_REF).replace("pw", "s3cret-value") });
    } catch (e) {
      expect(String((e as Error).message)).not.toContain("s3cret-value");
    }
  });
});
