import { cn } from "@/lib/utils";
import type { ReactNode } from "react";

const STYLES: Record<string, string> = {
  implemented: "border-success/30 bg-success/10 text-success",
  connected: "border-success/30 bg-success/10 text-success",
  approved: "border-success/30 bg-success/10 text-success",
  succeeded: "border-success/30 bg-success/10 text-success",
  ready: "border-success/30 bg-success/10 text-success",
  active: "border-success/30 bg-success/10 text-success",
  pending: "border-warning/30 bg-warning/10 text-warning",
  trialing: "border-warning/30 bg-warning/10 text-warning",
  processing: "border-warning/30 bg-warning/10 text-warning",
  running: "border-warning/30 bg-warning/10 text-warning",
  simulated: "border-warning/30 bg-warning/10 text-warning",
  rejected: "border-destructive/30 bg-destructive/10 text-destructive",
  failed: "border-destructive/30 bg-destructive/10 text-destructive",
  high: "border-destructive/30 bg-destructive/10 text-destructive",
  medium: "border-warning/30 bg-warning/10 text-warning",
};
const LABELS: Record<string, string> = { not_configured: "Not configured", planned: "Planned", implemented: "Available" };

export function StatusChip({ status, children }: { status: string; children?: ReactNode }) {
  return (
    <span className={cn("inline-flex items-center rounded-full border px-2 py-0.5 text-[11px] font-medium capitalize", STYLES[status] ?? "border-border bg-muted text-muted-foreground")}>
      {children ?? LABELS[status] ?? status.replace(/_/g, " ")}
    </span>
  );
}

export function PageHeader({ title, description, actions }: { title: string; description?: string; actions?: ReactNode }) {
  return (
    <div className="mb-8 flex flex-wrap items-center justify-between gap-4 border-b border-border pb-6">
      <div>
        <h1 className="text-2xl font-semibold md:text-3xl">{title}</h1>
        {description && <p className="mt-1 max-w-2xl text-sm text-muted-foreground">{description}</p>}
      </div>
      {actions}
    </div>
  );
}

export function EmptyState({ icon, title, text, action }: { icon?: ReactNode; title: string; text: string; action?: ReactNode }) {
  return (
    <div className="py-12 text-center">
      {icon && <div className="mx-auto mb-3 flex h-10 w-10 items-center justify-center rounded-full bg-muted text-muted-foreground">{icon}</div>}
      <h3 className="font-semibold">{title}</h3>
      <p className="mx-auto mt-1 max-w-sm text-sm text-muted-foreground">{text}</p>
      {action && <div className="mt-4">{action}</div>}
    </div>
  );
}

export function Panel({ className, children }: { className?: string; children: ReactNode }) {
  return <div className={cn("min-w-0 rounded-lg border border-border bg-card p-5", className)}>{children}</div>;
}
