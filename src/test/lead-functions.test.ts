import { afterEach, beforeEach, describe, it, expect, vi } from "vitest";
import { STAGING_REF, STAGING_URL } from "@/lib/environment";
const db = vi.hoisted(() => ({ rpc: vi.fn(), create: vi.fn() }));
vi.mock("@/integrations/supabase/auth-middleware", () => ({ requireSupabaseAuth: {} }));
// The complete environment guard is independently tested in lead-contract.test.ts.
vi.mock("@/lib/lead-contract", async (original) => ({
  ...(await original<typeof import("@/lib/lead-contract")>()),
  leadRuntimeAllowed: (env: Record<string, string | undefined>) =>
    env["APP_ENVIRONMENT"] === "staging",
}));
vi.mock("@supabase/supabase-js", () => ({
  createClient: (...args: unknown[]) => {
    db.create(...args);
    return { rpc: db.rpc };
  },
}));
vi.mock("@tanstack/react-start", () => ({
  createServerFn: () => {
    let validate: (input: unknown) => unknown = (input) => input;
    const builder = {
      middleware: () => builder,
      inputValidator: (fn: (input: unknown) => unknown) => {
        validate = fn;
        return builder;
      },
      handler: (fn: (input: { data: unknown }) => unknown) => async (input: { data: unknown }) =>
        fn({ data: validate(input.data) }),
    };
    return builder;
  },
}));
import { getPublicLeadForm, openLeadSession, submitPublicLead } from "@/lib/lead.functions";
const copy = {
  title: "Test enquiry",
  intro: "",
  consent: "I consent to contact for this specific enquiry only.",
};
const form = {
  key: "qa-enquiry-form",
  businessName: "Test business",
  privacyUrl: "https://example.test/privacy",
  copy: { en: copy, nl: copy, fr: copy },
};
const input = {
  formKey: form.key,
  name: "Test person",
  email: "test@example.test",
  consent: true as const,
  consentText: copy.consent,
  privacyUrl: form.privacyUrl,
  sessionId: "b0000000-0000-0000-0000-000000000001",
  requestId: "b0000000-0000-0000-0000-000000000002",
  locale: "en" as const,
  phone: "",
  message: "",
  website: "",
  attribution: { source: "", medium: "", campaign: "" },
};
describe("public lead server boundary (mocked SQL transport)", () => {
  beforeEach(() => {
    db.rpc.mockReset();
    db.create.mockReset();
    vi.stubEnv("APP_ENVIRONMENT", "staging");
    vi.stubEnv("VITE_APP_ENVIRONMENT", "staging");
    vi.stubEnv("SUPABASE_URL", STAGING_URL);
    vi.stubEnv("VITE_SUPABASE_URL", STAGING_URL);
    vi.stubEnv("SUPABASE_PROJECT_ID", STAGING_REF);
    vi.stubEnv("VITE_SUPABASE_PROJECT_ID", STAGING_REF);
    vi.stubEnv("SUPABASE_PUBLISHABLE_KEY", "test-publishable");
    vi.stubEnv("SUPABASE_SERVICE_ROLE_KEY", "");
    vi.stubEnv("AI_ACCOUNTING_SECRET", "test-proof");
  });
  afterEach(() => vi.unstubAllEnvs());
  it("refuses production before creating a client or writing", async () => {
    vi.stubEnv("APP_ENVIRONMENT", "production");
    expect(await submitPublicLead({ data: input })).toEqual({ ok: false, error: "unavailable" });
    expect(db.rpc).not.toHaveBeenCalled();
    expect(db.create).not.toHaveBeenCalled();
  });
  it("rejects invalid consent before any SQL call", async () => {
    await expect(
      submitPublicLead({ data: { ...input, consent: false } as unknown as typeof input }),
    ).rejects.toThrow();
    expect(db.rpc).not.toHaveBeenCalled();
  });
  it("returns only the allowlisted public form configuration", async () => {
    db.rpc.mockResolvedValue({
      data: { ...form, org_id: "private", contact: "private" },
      error: null,
    });
    const result = await getPublicLeadForm({ data: { formKey: form.key } });
    expect(result).toEqual({ ok: true, form });
  });
  it("cannot claim success on a failed atomic persistence RPC", async () => {
    db.rpc.mockResolvedValue({ data: null, error: { message: "private database detail" } });
    expect(await submitPublicLead({ data: input })).toEqual({ ok: false, error: "unavailable" });
  });
  it("sends the immutable consent/request snapshot through one narrow atomic RPC", async () => {
    db.rpc.mockResolvedValue({ data: true, error: null });
    expect(await submitPublicLead({ data: input })).toEqual({ ok: true });
    expect(db.rpc).toHaveBeenCalledExactlyOnceWith("submit_public_lead", { _input: input });
  });
  it("turns a session rate refusal into a safe public error", async () => {
    db.rpc.mockResolvedValue({ data: null, error: { message: "lead_limited" } });
    expect(await openLeadSession({ data: { formKey: form.key } })).toEqual({
      ok: false,
      error: "limited",
    });
  });
});
