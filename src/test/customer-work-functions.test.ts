import { beforeEach, describe, it, expect, vi } from "vitest";
import { customerInputLabel, customerWorkLabels } from "@/lib/customer-work";
const db = vi.hoisted(() => ({
  role: vi.fn(),
  source: vi.fn(),
  read: vi.fn(),
  insert: vi.fn(),
  eq: vi.fn(),
}));
const userId = "b0000000-0000-0000-0000-000000000009";
vi.mock("@/integrations/supabase/auth-middleware", () => ({ requireSupabaseAuth: {} }));
vi.mock("@tanstack/react-start", () => ({
  createServerFn: () => {
    let validator: (data: unknown) => unknown = (data) => data;
    const client = {
      rpc: db.role,
      from: (table: string) => {
        const query = {
          select: () => query,
          eq: (...args: unknown[]) => {
            db.eq(table, ...args);
            return query;
          },
          maybeSingle: table === "crm_deals" ? db.source : db.read,
          insert: db.insert,
        };
        return query;
      },
    };
    const builder = {
      middleware: () => builder,
      inputValidator: (fn: typeof validator) => {
        validator = fn;
        return builder;
      },
      handler:
        (
          fn: (args: {
            data: unknown;
            context: { supabase: typeof client; userId: string };
          }) => unknown,
        ) =>
        (args: { data: unknown }) =>
          fn({ data: validator(args.data), context: { supabase: client, userId } }),
    };
    return builder;
  },
}));
import { prepareCustomerWork } from "@/lib/customer-work.functions";
const input = {
  orgId: "b0000000-0000-0000-0000-000000000001",
  workspaceId: "b0000000-0000-0000-0000-000000000002",
  dealId: "b0000000-0000-0000-0000-000000000003",
  requestId: "b0000000-0000-0000-0000-000000000004",
  purpose: "retention" as const,
  title: "Delivery check",
  description: "Confirm consent before contact",
  due: "2026-12-01",
};
async function previous() {
  return {
    id: input.requestId,
    title: input.title,
    due_date: input.due,
    description: "stored snapshot",
    labels: [...customerWorkLabels(input.dealId, input.purpose), await customerInputLabel(input)],
    created_by: userId,
  };
}
describe("customer work authenticated boundary (mocked caller, not database E2E)", () => {
  beforeEach(() => {
    db.role.mockReset().mockResolvedValue({ data: true, error: null });
    db.source.mockReset().mockResolvedValue({
      data: {
        id: input.dealId,
        title: "Recorded sale",
        stage: "won",
        contact_id: null,
        lost_reason: "",
      },
      error: null,
    });
    db.read.mockReset().mockResolvedValue({ data: null, error: null });
    db.insert.mockReset().mockResolvedValue({ error: null });
    db.eq.mockReset();
  });
  it("refuses a viewer before reading customer information or inserting work", async () => {
    db.role.mockResolvedValue({ data: false, error: null });
    await expect(prepareCustomerWork({ data: input })).rejects.toThrow("denied");
    expect(db.source).not.toHaveBeenCalled();
    expect(db.insert).not.toHaveBeenCalled();
  });
  it("fails closed when the role check fails", async () => {
    db.role.mockResolvedValue({ data: true, error: { message: "offline" } });
    await expect(prepareCustomerWork({ data: input })).rejects.toThrow("denied");
    expect(db.insert).not.toHaveBeenCalled();
  });
  it("does not prepare retention from a sale that is no longer won", async () => {
    db.source.mockResolvedValue({ data: { stage: "proposal" }, error: null });
    await expect(prepareCustomerWork({ data: input })).rejects.toThrow("changed");
    expect(db.insert).not.toHaveBeenCalled();
  });
  it("refuses unreadable or inaccessible source data", async () => {
    db.source.mockResolvedValue({ data: null, error: null });
    await expect(prepareCustomerWork({ data: input })).rejects.toThrow("unavailable");
    expect(db.insert).not.toHaveBeenCalled();
  });
  it("reads the exact organization, business and sale before recovering the original request", async () => {
    db.read.mockResolvedValue({ data: await previous(), error: null });
    expect(await prepareCustomerWork({ data: input })).toEqual({ id: input.requestId });
    expect(db.eq).toHaveBeenCalledWith("crm_deals", "org_id", input.orgId);
    expect(db.eq).toHaveBeenCalledWith("crm_deals", "workspace_id", input.workspaceId);
    expect(db.eq).toHaveBeenCalledWith("crm_deals", "id", input.dealId);
    expect(db.insert).not.toHaveBeenCalled();
  });
  it("never reuses a completed request ID with a different brief", async () => {
    db.read.mockResolvedValue({ data: await previous(), error: null });
    await expect(
      prepareCustomerWork({ data: { ...input, description: "Different" } }),
    ).rejects.toThrow("changed");
    expect(db.insert).not.toHaveBeenCalled();
  });
  it("never claims preparation without read-back", async () => {
    await expect(prepareCustomerWork({ data: input })).rejects.toThrow("unavailable");
    expect(db.insert).toHaveBeenCalledTimes(1);
  });
  it("assigns internal work to the caller and confirms the exact recorded task", async () => {
    db.read.mockResolvedValueOnce({ data: null, error: null }).mockImplementationOnce(async () => {
      const row = db.insert.mock.calls[0]?.[0] as Record<string, unknown> | undefined;
      return { data: row, error: null };
    });
    expect(await prepareCustomerWork({ data: input })).toEqual({ id: input.requestId });
    expect(db.insert).toHaveBeenCalledWith(
      expect.objectContaining({
        id: input.requestId,
        org_id: input.orgId,
        workspace_id: input.workspaceId,
        owner_id: userId,
        created_by: userId,
      }),
    );
    expect(db.role).toHaveBeenCalledExactlyOnceWith("has_workspace_role", {
      _workspace: input.workspaceId,
      _min: "member",
    });
  });
});
