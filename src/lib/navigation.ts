import {
  ClipboardList,
  Coins,
  LineChart,
  LayoutDashboard,
  Sparkles,
  Building2,
  FileText,
  CheckSquare,
  Activity,
  Plug,
  Boxes,
  Settings,
  CreditCard,
  Compass,
  FolderKanban,
  Megaphone,
  Bell,
  PenSquare,
  Target,
  Handshake,
  Search,
  Eye,
  Lightbulb,
  Send,
  BarChart3,
  Banknote,
  FlaskConical,
  TrendingUp,
  Network,
  Bot,
  ListChecks,
  Wallet,
} from "lucide-react";

/**
 * Primary destinations start with campaigns, then strategy, AI guidance, execution, results and business settings.
 * Each group's items are its contextual tabs; URLs
 * never change when items move between groups, so saved links stay valid. Keep each group to seven items or fewer.
 */
export const NAVIGATION = [
  {
    group: "Campaigns",
    items: [
      { to: "/app", label: "Campaign overview", icon: Megaphone, exact: true },
      { to: "/app/campaigns", label: "Campaign workspace", icon: Megaphone },
      { to: "/app/notifications", label: "Notifications", icon: Bell },
    ],
  },
  {
    group: "Plan",
    items: [
      { to: "/app/goals", label: "Goals & budget", icon: Target },
      { to: "/app/opportunities", label: "Growth opportunities", icon: Lightbulb },
      { to: "/app/intelligence", label: "Growth intelligence", icon: Compass },
      { to: "/app/modules", label: "Growth areas", icon: Boxes },
      { to: "/app/costs", label: "Costs & ROI", icon: Wallet },
    ],
  },
  {
    group: "AI team",
    items: [
      { to: "/app/growth-officer", label: "Growth Officer", icon: Sparkles },
      { to: "/app/agents", label: "AI specialists", icon: Bot },
    ],
  },
  {
    group: "Execution",
    items: [
      { to: "/app/tasks", label: "Tasks", icon: ListChecks },
      { to: "/app/projects", label: "Projects", icon: FolderKanban },
      { to: "/app/content", label: "Content Studio", icon: PenSquare },
      { to: "/app/actions", label: "External actions", icon: Send },
      { to: "/app/approvals", label: "Review & approvals", icon: CheckSquare },
      { to: "/app/activity", label: "Activity & results", icon: Activity },
    ],
  },
  {
    group: "Results",
    items: [
      { to: "/app/business", label: "Business performance", icon: BarChart3 },
      { to: "/app/performance", label: "Performance", icon: LineChart },
      { to: "/app/revenue", label: "Revenue & attribution", icon: Banknote },
      { to: "/app/economics", label: "Growth economics", icon: Coins },
      { to: "/app/experiments", label: "Experiments", icon: FlaskConical },
      { to: "/app/reports", label: "Business reports", icon: ClipboardList },
      { to: "/app/improvements", label: "Improvements", icon: TrendingUp },
    ],
  },
  {
    group: "Business",
    items: [
      { to: "/app/profile", label: "Business knowledge", icon: Building2 },
      { to: "/app/documents", label: "Documents", icon: FileText },
      { to: "/app/seo", label: "Website check", icon: Search },
      { to: "/app/competitors", label: "Competitors", icon: Eye },
      { to: "/app/pipeline", label: "Sales pipeline", icon: Handshake },
      { to: "/app/overview", label: "Business overview", icon: LayoutDashboard },
    ],
  },
  {
    group: "Organization",
    items: [
      { to: "/app/organization", label: "Organization overview", icon: Network },
      { to: "/app/settings", label: "Organization & team", icon: Settings },
      { to: "/app/integrations", label: "Data sources", icon: Plug },
      { to: "/app/billing", label: "Plan & credits", icon: CreditCard },
    ],
  },
] as const;

/** Where pages outside the menu (onboarding, detail pages without a parent) belong. */
export const FALLBACK_GROUP = "Business";

export const primaryNavigation = NAVIGATION.map((group) => ({
  ...group.items[0],
  group: group.group,
}));
