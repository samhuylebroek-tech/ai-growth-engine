import { LayoutDashboard, Sparkles, Building2, FileText, CheckSquare, Activity, Plug, Bot, Boxes, Settings, CreditCard } from "lucide-react";

export const NAVIGATION = [
  { group: "Home", items: [{ to: "/app", label: "Overview", icon: LayoutDashboard, exact: true }, { to: "/app/growth-officer", label: "Growth Officer", icon: Sparkles }] },
  { group: "Knowledge", items: [{ to: "/app/profile", label: "Business profile", icon: Building2 }, { to: "/app/documents", label: "Documents", icon: FileText }] },
  { group: "Automation", items: [{ to: "/app/approvals", label: "Approvals", icon: CheckSquare }, { to: "/app/activity", label: "AI activity", icon: Activity }, { to: "/app/agents", label: "AI agents", icon: Bot }] },
  { group: "Connect", items: [{ to: "/app/integrations", label: "Integrations", icon: Plug }, { to: "/app/modules", label: "Extensions", icon: Boxes }] },
  { group: "Settings", items: [{ to: "/app/settings", label: "Organization & team", icon: Settings }, { to: "/app/billing", label: "Plan & usage", icon: CreditCard }] },
] as const;