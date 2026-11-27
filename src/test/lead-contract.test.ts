import { describe, it, expect } from "vitest";
import {
  leadSubmitSchema,
  publicLeadFormSchema,
  leadFormConfigSchema,
  leadRuntimeAllowed,
  leadError,
  leadTriage,
} from "@/lib/lead-contract";
import { STAGING_REF, STAGING_URL, PRODUCTION_REF } from "@/lib/environment";
const consent = "I consent to being contacted about this enquiry. This is not marketing consent.";
const copy = { title: "Contact the test business", intro: "", consent };
const form = {
  key: "qa-enquiry-form",
  businessName: "Test business",
  privacyUrl: "https://example.test/privacy",
  copy: { en: copy, nl: copy, fr: copy },
};
const submission = {
  formKey: form.key,
  sessionId: "b0000000-0000-0000-0000-000000000001",
  requestId: "b0000000-0000-0000-0000-000000000002",
  name: " Ann ",
  email: " ANN@Example.test ",
  consent: true,
  consentText: consent,
  privacyUrl: form.privacyUrl,
  locale: "en",
};
describe("lead contract", () => {
  it("keeps unqualified enquiries pending even when a follow-up record exists", () => {
    expect(leadTriage("lead-a", [], [{ submission_id: "lead-a" }])).toBe("pending");
  });
  it("classifies a qualified enquiry with a follow-up as prepared, not executed", () => {
    const decisions = [
      {
        id: "a",
        submission_id: "lead-a",
        created_at: "2026-11-26T12:00:00Z",
        decision: "qualified" as const,
      },
    ];
    expect(leadTriage("lead-a", decisions, [])).toBe("qualified");
    expect(leadTriage("lead-a", decisions, [{ submission_id: "lead-a" }])).toBe("ready");
    expect(leadTriage("lead-b", decisions, [])).toBe("pending");
  });
  it("uses the latest human decision instead of an obsolete qualification or another enquiry", () => {
    expect(
      leadTriage(
        "lead-a",
        [
          {
            id: "a",
            submission_id: "lead-a",
            created_at: "2026-11-26T12:00:00Z",
            decision: "qualified",
          },
          {
            id: "b",
            submission_id: "lead-a",
            created_at: "2026-11-26T13:00:00Z",
            decision: "not_fit",
          },
          {
            id: "c",
            submission_id: "lead-b",
            created_at: "2026-11-26T14:00:00Z",
            decision: "qualified",
          },
        ],
        [{ submission_id: "lead-a" }],
      ),
    ).toBe("not_fit");
  });
  it("requires consent rather than accepting a missing or false value", () => {
    expect(leadSubmitSchema.safeParse({ ...submission, consent: false }).success).toBe(false);
    expect(leadSubmitSchema.safeParse({ ...submission, consent: undefined }).success).toBe(false);
  });
  it("preserves the exact consent wording and request identity, with normalized contact details", () => {
    const result = leadSubmitSchema.parse(submission);
    expect(result.email).toBe("ann@example.test");
    expect(result.name).toBe("Ann");
    expect(result.consentText).toBe(consent);
    expect(result.requestId).toBe(submission.requestId);
  });
  it("requires a session and bounded attribution, rejecting spam", () => {
    expect(leadSubmitSchema.safeParse({ ...submission, sessionId: "" }).success).toBe(false);
    expect(leadSubmitSchema.safeParse({ ...submission, website: "bot" }).success).toBe(false);
    expect(
      leadSubmitSchema.safeParse({ ...submission, attribution: { source: "x".repeat(121) } })
        .success,
    ).toBe(false);
  });
  it("requires all languages and HTTPS privacy copy, without public tenant identifiers", () => {
    expect(publicLeadFormSchema.safeParse({ ...form, copy: { en: copy } }).success).toBe(false);
    expect(
      publicLeadFormSchema.safeParse({ ...form, privacyUrl: "javascript:alert(1)" }).success,
    ).toBe(false);
    const parsed = publicLeadFormSchema.parse({
      ...form,
      org_id: "secret",
      workspace_id: "secret",
    });
    expect(parsed).not.toHaveProperty("org_id");
    expect(parsed).not.toHaveProperty("workspace_id");
  });
  it("rejects forms with missing consent wording", () => {
    expect(
      publicLeadFormSchema.safeParse({
        ...form,
        copy: { ...form.copy, fr: { ...copy, consent: "" } },
      }).success,
    ).toBe(false);
  });
  it("requires bounded submission/session caps", () => {
    const config = {
      ...form,
      workspaceId: "b0000000-0000-0000-0000-000000000001",
      active: false,
      dailyLimit: 100,
      hourlyLimit: 30,
    };
    expect(leadFormConfigSchema.safeParse(config).success).toBe(true);
    expect(leadFormConfigSchema.safeParse({ ...config, hourlyLimit: 0 }).success).toBe(false);
    expect(leadFormConfigSchema.safeParse({ ...config, dailyLimit: 1001 }).success).toBe(false);
  });
  it("fails closed outside the authorized unmixed staging environment", () => {
    const staging = {
      APP_ENVIRONMENT: "staging",
      SUPABASE_URL: STAGING_URL,
      SUPABASE_PUBLISHABLE_KEY: "test-key",
      AI_ACCOUNTING_SECRET: "test-proof",
      SUPABASE_PROJECT_ID: STAGING_REF,
    };
    expect(leadRuntimeAllowed(staging)).toBe(true);
    expect(leadRuntimeAllowed({})).toBe(false);
    expect(leadRuntimeAllowed({ ...staging, APP_ENVIRONMENT: "production" })).toBe(false);
    expect(leadRuntimeAllowed({ ...staging, SUPABASE_PROJECT_ID: PRODUCTION_REF })).toBe(false);
  });
  it("does not expose database errors or identifiers to a visitor", () => {
    expect(leadError("private org 123 permission denied")).toBe("unavailable");
    expect(leadError("lead_limited")).toBe("limited");
  });
});
