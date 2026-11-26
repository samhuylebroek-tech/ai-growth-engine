import { afterEach, beforeEach, describe, it, expect, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { Pipeline } from "@/components/crm/pipeline";
const db = vi.hoisted(() => ({
  insert: vi.fn(),
  invalidate: vi.fn(),
  update: vi.fn(),
  eq: vi.fn(),
  single: vi.fn(),
}));
vi.mock("@/components/crm/guidance", () => ({ CrmGuidance: () => null }));
vi.mock("@/lib/org-context", () => ({
  useOrg: () => ({
    org: { id: "org-a" },
    workspace: { id: "ws-a" },
    workspaceRole: "member",
    loading: false,
  }),
}));
vi.mock("@tanstack/react-router", () => ({
  Link: ({ to, children }: { to: string; children: React.ReactNode }) => (
    <a href={to}>{children}</a>
  ),
}));
vi.mock("@tanstack/react-query", () => ({
  useQueryClient: () => ({ invalidateQueries: db.invalidate }),
  useQuery: () => ({
    isLoading: false,
    error: null,
    data: {
      contacts: [
        {
          id: "contact-a",
          name: "Élodie",
          company: "Studio",
          email: "elodie@example.test",
          phone: "",
          source: "lead-form:website",
          status: "active",
        },
      ],
      deals: [
        {
          id: "deal-a",
          title: "Design proposal",
          contact_id: "contact-a",
          stage: "proposal",
          value: 100,
          currency: "EUR",
          expected_close: null,
          updated_at: "2026-11-26",
        },
        {
          id: "deal-b",
          title: "Completed sale",
          contact_id: "contact-a",
          stage: "won",
          value: 500,
          currency: "USD",
          expected_close: null,
          updated_at: "2026-11-25",
        },
      ],
      goals: [],
    },
  }),
}));
vi.mock("@/integrations/supabase/client", () => ({
  supabase: { from: () => ({ insert: db.insert, update: db.update }) },
}));
describe("CRM workflows (mocked caller data, not authenticated E2E)", () => {
  beforeEach(() => {
    db.insert.mockReset().mockResolvedValue({ error: null });
    db.invalidate.mockReset().mockResolvedValue(undefined);
    const query = { eq: db.eq, select: () => query, single: db.single };
    db.eq.mockReset().mockReturnValue(query);
    db.update.mockReset().mockReturnValue(query);
    db.single.mockReset().mockResolvedValue({ data: { id: "deal-a" }, error: null });
  });
  afterEach(cleanup);
  it("keeps a refused loss decision open with its reason and does not claim a saved change", async () => {
    db.single.mockResolvedValueOnce({ data: null, error: { message: "denied" } });
    render(<Pipeline />);
    fireEvent.click(screen.getByRole("button", { name: "Lost" }));
    fireEvent.change(screen.getByLabelText("Why was this deal lost? (optional)"), {
      target: { value: "Budget" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Record decision" }));
    await waitFor(() =>
      expect(screen.getByRole("button", { name: "Record decision" })).toBeEnabled(),
    );
    expect(screen.getByRole("dialog")).toBeInTheDocument();
    expect(screen.getByLabelText("Why was this deal lost? (optional)")).toHaveValue("Budget");
    expect(db.invalidate).not.toHaveBeenCalled();
  });
  it("preserves an unsaved contact and restores controls after a transport failure", async () => {
    db.insert.mockRejectedValueOnce(new Error("offline"));
    render(<Pipeline />);
    fireEvent.click(screen.getByRole("button", { name: /Contacts/ }));
    fireEvent.click(screen.getByRole("button", { name: "Add contact" }));
    fireEvent.change(screen.getByLabelText("Contact name"), { target: { value: "Retry person" } });
    const save = screen.getAllByRole("button", { name: "Add contact" }).at(-1);
    if (!save) throw new Error("contact save action missing");
    fireEvent.click(save);
    await waitFor(() => expect(db.insert).toHaveBeenCalledTimes(1));
    await waitFor(() => expect(save).toBeEnabled());
    expect(screen.getByLabelText("Contact name")).toHaveValue("Retry person");
    expect(db.invalidate).not.toHaveBeenCalled();
  });
  it("preserves an unsaved sale and restores controls after a transport failure", async () => {
    db.insert.mockRejectedValueOnce(new Error("offline"));
    render(<Pipeline initialContact="contact-a" />);
    fireEvent.click(screen.getByRole("button", { name: "Add deal" }));
    fireEvent.change(screen.getByLabelText("Deal name"), { target: { value: "Retry sale" } });
    const save = screen.getAllByRole("button", { name: "Add deal" }).at(-1);
    if (!save) throw new Error("sale save action missing");
    fireEvent.click(save);
    await waitFor(() => expect(db.insert).toHaveBeenCalledTimes(1));
    await waitFor(() => expect(save).toBeEnabled());
    expect(screen.getByLabelText("Deal name")).toHaveValue("Retry sale");
    expect(db.invalidate).not.toHaveBeenCalled();
  });
  it("does not mark a sale lost when the user cancels the loss decision", () => {
    render(<Pipeline />);
    fireEvent.click(screen.getByRole("button", { name: "Lost" }));
    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    expect(db.update).not.toHaveBeenCalled();
    expect(screen.queryByRole("dialog")).toBeNull();
  });
  it("records the confirmed loss reason under the exact organization and business", async () => {
    render(<Pipeline />);
    fireEvent.click(screen.getByRole("button", { name: "Lost" }));
    fireEvent.change(screen.getByLabelText("Why was this deal lost? (optional)"), {
      target: { value: "Timing" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Record decision" }));
    await waitFor(() => expect(db.single).toHaveBeenCalledTimes(1));
    expect(db.update).toHaveBeenCalledWith({ stage: "lost", lost_reason: "Timing" });
    expect(db.eq).toHaveBeenCalledWith("id", "deal-a");
    expect(db.eq).toHaveBeenCalledWith("org_id", "org-a");
    expect(db.eq).toHaveBeenCalledWith("workspace_id", "ws-a");
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
  });
  it("opens the exact enquiry contact and starts a sale with that contact selected", async () => {
    render(<Pipeline initialContact="contact-a" />);
    fireEvent.click(screen.getByRole("button", { name: "Add deal" }));
    expect(screen.getByLabelText("Contact")).toHaveValue("contact-a");
    fireEvent.change(screen.getByLabelText("Deal name"), {
      target: { value: "Follow-up proposal" },
    });
    const save = screen.getAllByRole("button", { name: "Add deal" }).at(-1);
    if (!save) throw new Error("sale save action missing");
    fireEvent.click(save);
    await waitFor(() => expect(db.insert).toHaveBeenCalledTimes(1));
    expect(db.insert).toHaveBeenCalledWith(
      expect.objectContaining({
        contact_id: "contact-a",
        org_id: "org-a",
        workspace_id: "ws-a",
        title: "Follow-up proposal",
      }),
    );
  });
  it("does not fall back to another customer when a scoped contact is unavailable", () => {
    render(<Pipeline initialContact="unavailable-contact" />);
    expect(screen.queryByText("Élodie")).toBeNull();
    expect(screen.getByText("This customer is unavailable in this business.")).toBeInTheDocument();
    expect(db.insert).not.toHaveBeenCalled();
  });
  it("shows open sales first and reveals won sales only when requested", () => {
    render(<Pipeline />);
    expect(screen.getByText("Design proposal")).toBeInTheDocument();
    expect(screen.queryByText("Completed sale")).toBeNull();
    fireEvent.change(screen.getByLabelText("Sales to show"), { target: { value: "won" } });
    expect(screen.getByText("Completed sale")).toBeInTheDocument();
    expect(screen.queryByText("Design proposal")).toBeNull();
  });
  it("finds the contact without accents and preserves the route back to enquiries", () => {
    render(<Pipeline />);
    fireEvent.click(screen.getByRole("button", { name: /Contacts/ }));
    fireEvent.change(screen.getByLabelText("Search customers or sales"), {
      target: { value: "elodie" },
    });
    expect(screen.getByText("Élodie")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Enquiries & follow-up" })).toHaveAttribute(
      "href",
      "/app/leads",
    );
  });
  it("opens a labeled contact form, persists scoped input and reads back through invalidation", async () => {
    render(<Pipeline />);
    fireEvent.click(screen.getByRole("button", { name: /Contacts/ }));
    fireEvent.click(screen.getByRole("button", { name: "Add contact" }));
    fireEvent.change(screen.getByLabelText("Contact name"), { target: { value: "New person" } });
    fireEvent.change(screen.getByLabelText("Email"), { target: { value: " NEW@Example.test " } });
    fireEvent.click(screen.getAllByRole("button", { name: "Add contact" }).at(-1) as HTMLElement);
    await waitFor(() => expect(db.insert).toHaveBeenCalledTimes(1));
    expect(db.insert).toHaveBeenCalledWith(
      expect.objectContaining({
        org_id: "org-a",
        workspace_id: "ws-a",
        name: "New person",
        email: "new@example.test",
      }),
    );
    expect(db.invalidate).toHaveBeenCalled();
  });
});
