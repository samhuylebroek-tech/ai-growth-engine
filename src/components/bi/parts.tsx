// Shared pieces for business performance screens: number formatting, provenance badges, figures and filters.
import { useId, useState, type ReactNode } from "react";
import { ChevronDown } from "lucide-react";
import { useI18n } from "@/lib/i18n";
import type { MessageKey } from "@/lib/i18n/messages";
import type { BiData, Filters, ScopedMoney } from "@/lib/bi/view";
import { MODELS, type Model } from "@/lib/bi/attribution";
import { PERIODS } from "@/lib/bi/kpis";
import { cn } from "@/lib/utils";

export const sel = "w-full rounded-md border border-border bg-card px-2 py-1.5 text-xs";
export const tk = (k: string) => k as MessageKey;

export function useFmt() {
  const { tag } = useI18n();
  const money = (amount: number, currency: string) => {
    try {
      return new Intl.NumberFormat(tag, {
        style: "currency",
        currency,
        ...(Number.isInteger(Math.round(amount * 100) / 100) || Math.abs(amount) >= 1000
          ? { maximumFractionDigits: 0 }
          : { minimumFractionDigits: 2, maximumFractionDigits: 2 }),
      }).format(amount);
    } catch {
      return `${currency} ${amount}`;
    }
  };
  const num = (v: number, unit: string, currency: string | null = null) => {
    if (unit === "currency" && currency) return money(v, currency);
    if (unit === "percent")
      return `${new Intl.NumberFormat(tag, { maximumFractionDigits: 1 }).format(v)}%`;
    return new Intl.NumberFormat(tag, { maximumFractionDigits: unit === "ratio" ? 2 : 1 }).format(
      v,
    );
  };
  const date = (iso: string) =>
    new Intl.DateTimeFormat(tag, { day: "numeric", month: "short", year: "numeric" }).format(
      new Date(iso),
    );
  const moneyList = (m: ScopedMoney) =>
    m.length ? m.map((x) => money(x.amount, x.currency)).join(" · ") : null;
  return { money, num, date, moneyList };
}

const TONE: Record<string, string> = {
  actual: "border-primary/30 bg-primary/10 text-primary",
  manual: "border-border bg-muted text-foreground",
  estimated: "border-warning/40 bg-warning/10 text-warning",
  planned: "border-border bg-muted text-muted-foreground",
  high: "border-primary/30 bg-primary/10 text-primary",
  medium: "border-border bg-muted text-foreground",
  low: "border-warning/40 bg-warning/10 text-warning",
  none: "border-border bg-muted text-muted-foreground",
};
export function Badge({ kind, children }: { kind: string; children: ReactNode }) {
  return (
    <span
      className={cn(
        "inline-flex items-center rounded-full border px-2 py-0.5 text-2xs font-medium",
        TONE[kind] ?? TONE["none"],
      )}
    >
      {children}
    </span>
  );
}
export function ClassBadge({ cls }: { cls: string | null }) {
  const { t } = useI18n();
  if (!cls) return null;
  return <Badge kind={cls}>{t(tk(`bi.class.${cls}`))}</Badge>;
}

/** A figure always shows its source and period; when it cannot be shown, it says why. */
export function Figure({
  label,
  value,
  source,
  period,
  cls,
  missing,
  note,
}: {
  label: string;
  value: string | null;
  source: string;
  period: string;
  cls?: string | null;
  missing?: string | undefined;
  note?: string | undefined;
}) {
  return (
    <div className="flex min-w-0 flex-col rounded-lg border border-border bg-card p-3">
      <div className="flex items-start justify-between gap-2">
        <span className="text-2xs font-medium text-muted-foreground">{label}</span>
        {value !== null && <ClassBadge cls={cls ?? null} />}
      </div>
      {value !== null ? (
        <div className="mt-1 break-words text-lg font-semibold leading-tight">{value}</div>
      ) : (
        <div className="mt-1 text-xs text-muted-foreground">{missing}</div>
      )}
      {note && <p className="mt-1 text-2xs text-muted-foreground">{note}</p>}
      <div className="mt-auto pt-2 text-2xs text-muted-foreground">
        {source} · {period}
      </div>
    </div>
  );
}

export function FilterBar({
  data,
  filters,
  onChange,
  model,
  onModel,
}: {
  data: BiData;
  filters: Filters;
  onChange: (f: Filters) => void;
  model?: Model;
  onModel?: (m: Model) => void;
}) {
  const { t } = useI18n();
  const channels = [
    ...new Set(
      [
        ...data.budget.map((b) => b.channel.trim().toLowerCase()),
        ...data.metrics.map((m) => m.channel.trim().toLowerCase()),
        ...data.touches.map((x) => x.channel.trim().toLowerCase()),
      ].filter(Boolean),
    ),
  ].sort();
  const plans = data.plans.filter((p) => p.status === "approved" || p.status === "superseded");
  const set = (k: keyof Filters, v: string) => onChange({ ...filters, [k]: v === "" ? null : v });
  return (
    <div
      className="grid gap-2 rounded-lg border border-border bg-card p-3 sm:grid-cols-3 lg:grid-cols-6"
      role="group"
      aria-label={t("bi.filters")}
    >
      <label className="text-2xs">
        <span className="mb-1 block font-medium">{t("bi.f.period")}</span>
        <select
          className={sel}
          value={filters.period}
          onChange={(e) => onChange({ ...filters, period: e.target.value as Filters["period"] })}
        >
          {PERIODS.map((p) => (
            <option key={p} value={p}>
              {t(tk(`bi.period.${p}`))}
            </option>
          ))}
        </select>
      </label>
      <label className="text-2xs">
        <span className="mb-1 block font-medium">{t("bi.f.unit")}</span>
        <select
          className={sel}
          value={filters.unit ?? ""}
          onChange={(e) => set("unit", e.target.value)}
        >
          <option value="">{t("bi.f.wholeBusiness")}</option>
          {data.units
            .filter((u) => !u.archived)
            .map((u) => (
              <option key={u.id} value={u.id}>
                {u.name} ({t(tk(`bi.unitKind.${u.kind}`))})
              </option>
            ))}
        </select>
      </label>
      <label className="text-2xs">
        <span className="mb-1 block font-medium">{t("bi.f.strategy")}</span>
        <select
          className={sel}
          value={filters.plan ?? ""}
          onChange={(e) => set("plan", e.target.value)}
        >
          <option value="">{t("bi.f.all")}</option>
          {plans.map((p) => (
            <option key={p.id} value={p.id}>
              {p.title.length > 50 ? `${p.title.slice(0, 47)}…` : p.title} · v{p.version}
            </option>
          ))}
        </select>
      </label>
      <label className="text-2xs">
        <span className="mb-1 block font-medium">{t("bi.f.campaign")}</span>
        <select
          className={sel}
          value={filters.campaign ?? ""}
          onChange={(e) => set("campaign", e.target.value)}
        >
          <option value="">{t("bi.f.all")}</option>
          {data.campaigns.map((c) => (
            <option key={c.id} value={c.id}>
              {c.title}
            </option>
          ))}
        </select>
      </label>
      <label className="text-2xs">
        <span className="mb-1 block font-medium">{t("bi.f.channel")}</span>
        <select
          className={sel}
          value={filters.channel ?? ""}
          onChange={(e) => set("channel", e.target.value)}
        >
          <option value="">{t("bi.f.all")}</option>
          {channels.map((c) => (
            <option key={c} value={c}>
              {c}
            </option>
          ))}
        </select>
      </label>
      {onModel && model && (
        <label className="text-2xs">
          <span className="mb-1 block font-medium">{t("bi.f.model")}</span>
          <select className={sel} value={model} onChange={(e) => onModel(e.target.value as Model)}>
            {MODELS.map((m) => (
              <option key={m} value={m}>
                {t(tk(`bi.model.${m}`))}
              </option>
            ))}
          </select>
        </label>
      )}
    </div>
  );
}

/** A results section. `foldable` sections (advanced analysis) start closed behind their heading, keeping long
 * result pages scannable; the heading stays a real h2 so the page outline is unchanged. */
export function Section({
  title,
  intro,
  children,
  action,
  foldable = false,
}: {
  title: string;
  intro?: string;
  children: ReactNode;
  action?: ReactNode;
  foldable?: boolean;
}) {
  const [open, setOpen] = useState(!foldable);
  const id = useId();
  return (
    <section className="mt-8">
      <div className="mb-3 flex flex-wrap items-end justify-between gap-2">
        <div className="min-w-0">
          <h2 className="text-base font-semibold">
            {foldable ? (
              <button
                type="button"
                aria-expanded={open}
                aria-controls={id}
                onClick={() => setOpen((v) => !v)}
                className="flex min-h-11 items-center gap-2 text-left hover:text-primary"
              >
                <ChevronDown
                  aria-hidden
                  className={cn(
                    "h-4 w-4 shrink-0 text-muted-foreground transition-transform motion-reduce:transition-none",
                    !open && "-rotate-90",
                  )}
                />
                {title}
              </button>
            ) : (
              title
            )}
          </h2>
          {intro && (
            <p className={cn("mt-0.5 max-w-3xl text-xs text-muted-foreground", foldable && "pl-6")}>
              {intro}
            </p>
          )}
        </div>
        {open && action}
      </div>
      {open && <div id={id}>{children}</div>}
    </section>
  );
}

export function targetLabel(key: string, data: BiData): string {
  if (key.startsWith("campaign:"))
    return data.campaigns.find((c) => c.id === key.slice(9))?.title ?? key.slice(9, 17);
  if (key.startsWith("initiative:"))
    return data.initiatives.find((n) => n.id === key.slice(11))?.title ?? key.slice(11, 19);
  return key.replace(/^channel:/, "");
}
