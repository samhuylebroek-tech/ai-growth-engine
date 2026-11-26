import { afterEach, beforeEach, describe, it, expect, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { PublicForm } from "@/components/leads/public-form";
import type { PublicLeadForm } from "@/lib/lead-contract";
import { translate, type MessageKey } from "@/lib/i18n/messages";
const actions = vi.hoisted(() => ({ open: vi.fn(), send: vi.fn(), invalidate: vi.fn() }));
vi.mock("@tanstack/react-router", () => ({
  useRouter: () => ({ invalidate: actions.invalidate }),
}));
vi.mock("@/lib/lead.functions", () => ({ openLeadSession: "open", submitPublicLead: "submit" }));
vi.mock("@tanstack/react-start", () => ({
  useServerFn: (fn: string) => (fn === "open" ? actions.open : actions.send),
}));
vi.mock("@/lib/i18n", () => ({
  useI18n: () => ({
    locale: "en",
    t: (key: MessageKey) => translate("en", key),
    setLocale: vi.fn(),
  }),
}));
const session = "b0000000-0000-0000-0000-000000000001";
const copy = {
  title: "QA business enquiry",
  intro: "Contact the test business",
  consent: "I consent to contact about this enquiry only, not marketing.",
};
const form: PublicLeadForm = {
  key: "qa-enquiry-form",
  businessName: "QA test business",
  privacyUrl: "https://example.test/privacy",
  copy: { en: copy, nl: copy, fr: copy },
};
async function fill() {
  await waitFor(() => expect(actions.open).toHaveBeenCalledTimes(1));
  fireEvent.change(screen.getByLabelText("Name"), { target: { value: "Ann" } });
  fireEvent.change(screen.getByLabelText("Email"), { target: { value: "ann@example.test" } });
  fireEvent.click(screen.getByRole("checkbox"));
  await waitFor(() => expect(screen.getByRole("button", { name: "Send enquiry" })).toBeEnabled(), {
    timeout: 4000,
  });
}
describe("public form interactions (mocked transport, not persistence E2E)", () => {
  beforeEach(() => {
    actions.open.mockReset().mockResolvedValue({ ok: true, sessionId: session });
    actions.send.mockReset().mockResolvedValue({ ok: true });
  });
  afterEach(cleanup);
  it("can recover a refused session without losing typed enquiry details", async () => {
    actions.open
      .mockResolvedValueOnce({ ok: false, error: "unavailable" })
      .mockResolvedValueOnce({ ok: true, sessionId: session });
    render(<PublicForm form={form} />);
    await waitFor(() =>
      expect(screen.getByRole("button", { name: "Try again" })).toBeInTheDocument(),
    );
    fireEvent.change(screen.getByLabelText("Name"), { target: { value: "Ann" } });
    fireEvent.click(screen.getByRole("button", { name: "Try again" }));
    await waitFor(() => expect(actions.open).toHaveBeenCalledTimes(2));
    expect(screen.getByLabelText("Name")).toHaveValue("Ann");
    expect(actions.send).not.toHaveBeenCalled();
  });
  it("renews only an explicitly expired session before retrying the enquiry", async () => {
    const renewed = "b0000000-0000-0000-0000-000000000003";
    actions.send.mockResolvedValueOnce({ ok: false, error: "expired" });
    render(<PublicForm form={form} />);
    await fill();
    fireEvent.click(screen.getByRole("button", { name: "Send enquiry" }));
    await waitFor(() =>
      expect(screen.getByRole("button", { name: "Try again" })).toBeInTheDocument(),
    );
    actions.open.mockResolvedValueOnce({ ok: true, sessionId: renewed });
    fireEvent.click(screen.getByRole("button", { name: "Try again" }));
    await waitFor(
      () => expect(screen.getByRole("button", { name: "Send enquiry" })).toBeEnabled(),
      { timeout: 4000 },
    );
    expect(screen.getByLabelText("Email")).toHaveValue("ann@example.test");
    fireEvent.click(screen.getByRole("button", { name: "Send enquiry" }));
    await waitFor(() => expect(actions.send).toHaveBeenCalledTimes(2));
    expect(actions.send.mock.calls[1]?.[0]?.data.sessionId).toBe(renewed);
    await waitFor(() => expect(screen.getByRole("status")).toBeInTheDocument());
  }, 10000);
  it("submits exact consent, business capability and a stable request identity, without an account", async () => {
    render(<PublicForm form={form} />);
    await fill();
    fireEvent.click(screen.getByRole("button", { name: "Send enquiry" }));
    await waitFor(() => expect(actions.send).toHaveBeenCalledTimes(1));
    expect(actions.send.mock.calls[0]?.[0]?.data).toMatchObject({
      formKey: form.key,
      sessionId: session,
      consent: true,
      consentText: copy.consent,
      privacyUrl: form.privacyUrl,
      email: "ann@example.test",
    });
    await waitFor(() =>
      expect(screen.getByRole("status")).toHaveTextContent("Your enquiry has been received"),
    );
  });
  it("keeps the same request key on an unconfirmed transport retry", async () => {
    actions.send.mockRejectedValueOnce(new Error("network")).mockResolvedValueOnce({ ok: true });
    render(<PublicForm form={form} />);
    await fill();
    fireEvent.click(screen.getByRole("button", { name: "Send enquiry" }));
    await waitFor(() => expect(screen.getByRole("alert")).toBeInTheDocument());
    fireEvent.click(screen.getByRole("button", { name: "Send enquiry" }));
    await waitFor(() => expect(actions.send).toHaveBeenCalledTimes(2));
    expect(actions.send.mock.calls[1]?.[0]?.data.requestId).toBe(
      actions.send.mock.calls[0]?.[0]?.data.requestId,
    );
  });
  it("never claims success when the server refuses the submission", async () => {
    actions.send.mockResolvedValue({ ok: false, error: "limited" });
    render(<PublicForm form={form} />);
    await fill();
    fireEvent.click(screen.getByRole("button", { name: "Send enquiry" }));
    await waitFor(() => expect(screen.getByRole("alert")).toHaveTextContent("too many requests"));
    expect(screen.queryByRole("status")).toBeNull();
  });
  it("does not open a session or send when the business form is unavailable", () => {
    render(<PublicForm form={null} />);
    expect(actions.open).not.toHaveBeenCalled();
    expect(actions.send).not.toHaveBeenCalled();
    expect(screen.queryByRole("checkbox")).toBeNull();
  });
});
