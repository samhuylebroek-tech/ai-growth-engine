import { cn } from "@/lib/utils";
import type { ReactNode } from "react";
import { useI18n } from "@/lib/i18n";
import { MESSAGES } from "@/lib/i18n/messages";

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
  partial: "border-warning/30 bg-warning/10 text-warning",
  expired: "border-destructive/30 bg-destructive/10 text-destructive",
  insufficient_scope: "border-destructive/30 bg-destructive/10 text-destructive",
  error: "border-destructive/30 bg-destructive/10 text-destructive",
};
const LABELS: Record<string, string> = {
  not_configured: "Not configured",
  planned: "Planned",
  implemented: "Available",
  expired: "Access expired",
  insufficient_scope: "Missing permission",
  error: "Connection error",
};

const sentence = (s: string) => {
  const t = s.replace(/_/g, " ");
  return t.charAt(0).toUpperCase() + t.slice(1);
};

export function StatusChip({ status, children }: { status: string; children?: ReactNode }) {
  const { t, locale } = useI18n();
  const key = `status.${status}` as keyof typeof MESSAGES.en;
  const label =
    children ??
    (locale !== "en" && key in MESSAGES.en
      ? t(key)
      : (LABELS[status] ?? (key in MESSAGES.en ? t(key) : sentence(status))));
  return (
    <span
      className={cn(
        "inline-flex items-center rounded-full border px-2 py-0.5 text-[11px] font-medium",
        STYLES[status] ?? "border-border bg-muted text-muted-foreground",
      )}
    >
      {label}
    </span>
  );
}

/**
 * The one page header: optional back link and context line, the title, one sentence on what the page is for, extra
 * status (meta) and the page's main actions. Every module uses it so pages read and align the same way.
 */
export function PageHeader({
  title,
  description,
  actions,
  eyebrow,
  icon,
  back,
  meta,
}: {
  title: ReactNode;
  description?: ReactNode;
  actions?: ReactNode;
  eyebrow?: ReactNode;
  icon?: ReactNode;
  back?: ReactNode;
  meta?: ReactNode;
}) {
  return (
    <div className="mb-8 flex flex-wrap items-start justify-between gap-4">
      <div className="min-w-0">
        {back && <div className="mb-2 text-xs text-muted-foreground">{back}</div>}
        {eyebrow && <p className="section-label mb-2">{eyebrow}</p>}
        <h1 className="flex min-w-0 items-center gap-2 text-2xl font-semibold leading-tight">
          {icon}
          <span className="min-w-0 break-words">{title}</span>
        </h1>
        {description && (
          <p className="mt-1 max-w-2xl text-sm text-muted-foreground">{description}</p>
        )}
        {meta && <div className="mt-2 text-xs text-muted-foreground">{meta}</div>}
      </div>
      {actions && <div className="flex shrink-0 flex-wrap items-center gap-2">{actions}</div>}
    </div>
  );
}

export function EmptyState({
  icon,
  title,
  text,
  action,
}: {
  icon?: ReactNode;
  title: string;
  text: string;
  action?: ReactNode;
}) {
  return (
    <div className="border-y border-dashed border-border py-12 text-center">
      {icon && (
        <div className="mx-auto mb-3 flex h-10 w-10 items-center justify-center rounded-full bg-muted text-muted-foreground">
          {icon}
        </div>
      )}
      <h3 className="font-semibold">{title}</h3>
      <p className="mx-auto mt-1 max-w-sm text-sm text-muted-foreground">{text}</p>
      {action && <div className="mt-4">{action}</div>}
    </div>
  );
}

export function Panel({ className, children }: { className?: string; children: ReactNode }) {
  return (
    <div className={cn("min-w-0 rounded-lg border border-border bg-card p-5", className)}>
      {children}
    </div>
  );
}
