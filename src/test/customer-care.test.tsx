import { beforeEach, afterEach, describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent, waitFor, cleanup } from "@testing-library/react";
const state = vi.hoisted(() => ({
  prepare: vi.fn(),
  invalidate: vi.fn(),
  tasks: [] as {
    id: string;
    title: string;
    status: string;
    labels: string[];
    due_date: string | null;
  }[],
  error: false,
}));
vi.mock("@tanstack/react-start", async (original) => ({
  ...(await original<typeof import("@tanstack/react-start")>()),
  useServerFn: () => state.prepare,
}));
vi.mock("@tanstack/react-router", () => ({
  Link: ({ to, children }: { to: string; children: React.ReactNode }) => (
    <a href={to}>{children}</a>
  ),
}));
vi.mock("@tanstack/react-query", () => ({
  useQueryClient: () => ({ invalidateQueries: state.invalidate }),
  useQuery: () => ({ data: state.tasks, isError: state.error, refetch: vi.fn() }),
}));
vi.mock("@/components/crm/guidance", () => ({ CrmGuidance: () => null }));
import { CustomerCare } from "@/components/crm/customer-care";
const props = {
  orgId: "b0000000-0000-0000-0000-000000000001",
  wsId: "b0000000-0000-0000-0000-000000000002",
  canEdit: true,
  contactScope: undefined,
  contacts: [{ id: "contact-a", name: "Buyer" }],
  deals: [
    {
      id: "b0000000-0000-0000-0000-000000000003",
      title: "Recorded order",
      stage: "won",
      contact_id: "contact-a",
      expected_close: null,
    },
  ],
};
describe("customer care interactions (mocked persistence, not staging E2E)", () => {
  beforeEach(() => {
    state.prepare.mockReset().mockResolvedValue({ id: "task-a" });
    state.invalidate.mockReset().mockResolvedValue(undefined);
    state.tasks = [];
    state.error = false;
  });
  afterEach(cleanup);
  it("prepares an explicit scoped internal task, then links to its recorded result", async () => {
    render(<CustomerCare {...props} />);
    fireEvent.click(screen.getByRole("button", { name: "Prepare internal task" }));
    fireEvent.change(screen.getByLabelText("Action brief and checks before contacting"), {
      target: { value: "Check the delivery record first" },
    });
    fireEvent.click(
      screen.getAllByRole("button", { name: "Prepare internal task" }).at(-1) as HTMLElement,
    );
    await waitFor(() => expect(state.prepare).toHaveBeenCalledTimes(1));
    expect(state.prepare).toHaveBeenCalledWith({
      data: expect.objectContaining({
        orgId: props.orgId,
        workspaceId: props.wsId,
        dealId: props.deals[0]?.id,
        purpose: "retention",
        description: "Check the delivery record first",
      }),
    });
    expect(await screen.findByRole("link", { name: "Open follow-up task" })).toHaveAttribute(
      "href",
      "/app/tasks",
    );
  });
  it("retries an unconfirmed preparation with the same request and frozen brief", async () => {
    state.prepare.mockRejectedValueOnce(new Error("offline"));
    render(<CustomerCare {...props} />);
    fireEvent.click(screen.getByRole("button", { name: "Prepare internal task" }));
    fireEvent.click(
      screen.getAllByRole("button", { name: "Prepare internal task" }).at(-1) as HTMLElement,
    );
    const retry = await screen.findByRole("button", { name: "Try again" });
    expect(screen.getByLabelText("Follow-up task")).toBeDisabled();
    const first = state.prepare.mock.calls[0]?.[0];
    fireEvent.click(retry);
    await waitFor(() => expect(state.prepare).toHaveBeenCalledTimes(2));
    expect(state.prepare.mock.calls[1]?.[0]).toEqual(first);
  });
  it("does not prepare more work when this sale already has an open task", () => {
    state.tasks = [
      {
        id: "task-a",
        title: "Delivery check",
        status: "todo",
        labels: [`crm-deal:${props.deals[0]?.id}`],
        due_date: null,
      },
    ];
    render(<CustomerCare {...props} />);
    expect(screen.getByRole("button", { name: "Prepare internal task" })).toBeDisabled();
    expect(state.prepare).not.toHaveBeenCalled();
  });
  it("does not expose a prepare control to a viewer", () => {
    render(<CustomerCare {...props} canEdit={false} />);
    expect(screen.queryByRole("button", { name: "Prepare internal task" })).toBeNull();
  });
  it("fails closed on unreadable task history", () => {
    state.error = true;
    render(<CustomerCare {...props} />);
    expect(screen.getByRole("alert")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Prepare internal task" })).toBeNull();
  });
  it("never falls back to another customer's sales", () => {
    render(<CustomerCare {...props} contactScope="different-contact" />);
    expect(screen.queryByText("Recorded order")).toBeNull();
    expect(state.prepare).not.toHaveBeenCalled();
  });
});
