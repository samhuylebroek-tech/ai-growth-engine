// Component interactions with synthetic unit fixtures, not authenticated browser or database validation.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { CampaignIntelPanel } from "@/components/execution/campaign-intel-panel";
import { consumeGrowthContext, consumeGrowthDraft } from "@/lib/growth-draft";
import { translate, type MessageKey } from "@/lib/i18n/messages";

const state = vi.hoisted(() => ({ error: false, navigate: vi.fn() }));
vi.mock("@/lib/org-context", () => ({
  useOrg: () => ({
    org: { id: "org" },
    workspace: { id: "ws" },
    userId: "member",
    workspaceRole: "member",
  }),
}));
vi.mock("@/lib/i18n", () => ({
  useI18n: () => ({
    tag: "en",
    t: (key: MessageKey, vars?: Record<string, string | number>) => translate("en", key, vars),
  }),
}));
vi.mock("@tanstack/react-router", () => ({
  useNavigate: () => state.navigate,
  Link: ({ children }: { children: React.ReactNode }) => <span>{children}</span>,
}));
vi.mock("@/components/bi/bi-data", () => ({ biOptions: () => ({ queryKey: ["test-bi"] }) }));
vi.mock("@/components/execution/replan-data", () => ({
  campaignSpendOptions: () => ({ queryKey: ["test-spend"] }),
}));
vi.mock("@/components/app/situation-narrative", () => ({ AiExplanation: () => null }));
vi.mock("@tanstack/react-query", () => ({
  useQueryClient: () => ({ invalidateQueries: vi.fn() }),
  useQuery: ({ queryKey }: { queryKey: string[] }) => ({
    error: state.error ? new Error("read failed") : null,
    isLoading: false,
    data:
      queryKey[0] === "test-bi"
        ? {
            metrics: [
              {
                id: "a0000000-0000-4000-8000-000000000002",
                key: "leads",
                label: "Enquiries",
                campaign_id: "a0000000-0000-4000-8000-000000000001",
                archived: false,
              },
            ],
            measurements: [],
            revenue: [],
            touches: [],
            experiments: [
              {
                id: "e1",
                title: "Own offer experiment",
                campaign_id: "a0000000-0000-4000-8000-000000000001",
                status: "completed",
                evidence_strength: "controlled",
                result_data_class: "simulated",
              },
              {
                id: "e2",
                title: "Other campaign experiment",
                campaign_id: "other",
                status: "completed",
                evidence_strength: "controlled",
                result_data_class: "manual",
              },
            ],
          }
        : [],
  }),
}));

const campaign = {
  id: "a0000000-0000-4000-8000-000000000001",
  title: "Unit fixture campaign",
  status: "active",
  objective: "Enquiries",
  audience: "Local businesses",
  channels: ["Search"],
  budget_eur: 100,
  start_date: "2026-01-01",
  end_date: "2026-01-31",
  goal_id: "goal",
  results: "",
} as Parameters<typeof CampaignIntelPanel>[0]["campaign"];

describe("Campaign results connections (unit fixtures only)", () => {
  beforeEach(() => {
    state.error = false;
    state.navigate.mockClear();
    sessionStorage.clear();
  });
  afterEach(cleanup);
  it("passes linked experiments through the diagnosis and excludes another campaign's evidence", () => {
    render(<CampaignIntelPanel campaign={campaign} tasks={[]} campaigns={[campaign]} />);
    fireEvent.click(screen.getByText(translate("en", "ci.experiments"), { exact: false }));
    expect(screen.getByText("Own offer experiment")).toBeTruthy();
    expect(screen.queryByText("Other campaign experiment")).toBeNull();
    expect(screen.getByText(translate("en", "ci.exp.simulated"))).toBeTruthy();
  });
  it("prepares a scoped improvement question without starting AI work", () => {
    render(<CampaignIntelPanel campaign={campaign} tasks={[]} campaigns={[campaign]} />);
    fireEvent.click(
      screen.getAllByRole("button", { name: translate("en", "ci.guide") })[0] ??
        (() => {
          throw new Error("Missing guidance action");
        })(),
    );
    const draft = consumeGrowthDraft(sessionStorage, "org", "ws");
    expect(consumeGrowthContext(sessionStorage, "org", "ws", draft)).toEqual([
      { kind: "campaigns", id: campaign.id },
    ]);
    expect(state.navigate).toHaveBeenCalledWith({ to: "/app/growth-officer" });
  });
  it("does not show partial campaign evidence after a required read fails", () => {
    state.error = true;
    render(<CampaignIntelPanel campaign={campaign} tasks={[]} campaigns={[campaign]} />);
    expect(screen.queryByText("Own offer experiment")).toBeNull();
    expect(screen.queryAllByRole("button")).toHaveLength(0);
  });
});
