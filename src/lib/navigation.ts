import { LayoutDashboard, Sparkles, Building2, FileText, CheckSquare, Activity, Plug, Bot, Boxes, Settings, CreditCard, Compass, FolderKanban, Megaphone, Bell, PenSquare } from "lucide-react";

export const NAVIGATION = [
  { group: "Home", items: [{ to: "/app", label: "Home", icon: LayoutDashboard, exact: true }, { to: "/app/notifications", label: "Notifications", icon: Bell }] },
  { group: "Growth Officer", items: [{ to: "/app/growth-officer", label: "Growth Officer", icon: Sparkles }, { to: "/app/agents", label: "Specialists", icon: Bot }] },
  { group: "Intelligence", items: [{ to: "/app/intelligence", label: "Growth intelligence", icon: Compass }, { to: "/app/modules", label: "Growth areas", icon: Boxes }] },
  { group: "Work", items: [{ to: "/app/tasks", label: "Tasks", icon: CheckSquare }, { to: "/app/projects", label: "Projects", icon: FolderKanban }, { to: "/app/campaigns", label: "Campaigns", icon: Megaphone }, { to: "/app/content", label: "Content Studio", icon: PenSquare }, { to: "/app/approvals", label: "Review & approvals", icon: CheckSquare }, { to: "/app/activity", label: "Activity & results", icon: Activity }] },
  { group: "Knowledge", items: [{ to: "/app/profile", label: "Business knowledge", icon: Building2 }, { to: "/app/documents", label: "Documents", icon: FileText }] },
  { group: "Settings", items: [{ to: "/app/settings", label: "Organization & team", icon: Settings }, { to: "/app/integrations", label: "Data sources", icon: Plug }, { to: "/app/billing", label: "Plan & credits", icon: CreditCard }] },
] as const;

export const primaryNavigation = NAVIGATION.map(group => ({ ...group.items[0], group: group.group }));