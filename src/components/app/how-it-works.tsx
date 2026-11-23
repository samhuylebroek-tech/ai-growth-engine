import { useEffect, useState } from "react";
import { Link } from "@tanstack/react-router";
import { ArrowUpRight, X } from "lucide-react";
import { useI18n } from "@/lib/i18n";
import type { MessageKey } from "@/lib/i18n/messages";
import { Button } from "@/components/ui/button";

const STEPS = [
  { n: 1, to: "/app/profile" },
  { n: 2, to: "/app/goals" },
  { n: 3, to: "/app/growth-officer" },
  { n: 4, to: "/app/approvals" },
  { n: 5, to: "/app/tasks" },
  { n: 6, to: "/app/performance" },
] as const;
/** Per person (not per business): the guide explains the product, which is the same in every business. */
export const guideKey = (userId: string) => `age.guide.v1:${userId}`;

/** A short guide on Home for newcomers that teaches through the real pages; hidden once dismissed. */
export function HowItWorks({
  userId,
  open,
  onOpenChange,
}: {
  userId: string;
  open: boolean | null;
  onOpenChange: (v: boolean) => void;
}) {
  const { t } = useI18n();
  if (!open) return null;
  const close = () => {
    try {
      localStorage.setItem(guideKey(userId), "hidden");
    } catch {
      /* storage unavailable: hide for this visit */
    }
    onOpenChange(false);
  };
  return (
    <section
      aria-labelledby="guide-title"
      className="mb-6 rounded-xl border border-border bg-muted/30 p-5"
    >
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <h2 id="guide-title" className="text-base font-semibold">
            {t("gx.guide.title")}
          </h2>
          <p className="mt-1 max-w-2xl text-sm text-muted-foreground">{t("gx.guide.intro")}</p>
        </div>
        <Button
          variant="ghost"
          size="icon"
          className="shrink-0"
          aria-label={t("gx.guide.close")}
          onClick={close}
        >
          <X />
        </Button>
      </div>
      <ol className="mt-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {STEPS.map((s) => (
          <li key={s.n} className="flex gap-3 rounded-lg bg-card p-3">
            <span
              aria-hidden
              className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-primary/10 text-xs font-semibold text-primary"
            >
              {s.n}
            </span>
            <div className="min-w-0">
              <p className="text-sm font-medium">{t(`gx.guide.${s.n}.title` as MessageKey)}</p>
              <p className="mt-1 text-xs leading-relaxed text-muted-foreground">
                {t(`gx.guide.${s.n}.text` as MessageKey)}
              </p>
              <Link
                to={s.to}
                className="mt-1 inline-flex min-h-8 items-center gap-1 text-xs text-primary underline-offset-2 hover:underline"
              >
                {t("gx.guide.go")} <ArrowUpRight className="h-3 w-3" aria-hidden />
                <span className="sr-only">: {t(`gx.guide.${s.n}.title` as MessageKey)}</span>
              </Link>
            </div>
          </li>
        ))}
      </ol>
      <Button variant="outline" size="sm" className="mt-4" onClick={close}>
        {t("gx.guide.close")}
      </Button>
    </section>
  );
}

/** Whether the guide shows: read after hydration so server and client render the same first frame. */
export function useGuide(userId: string) {
  const [open, setOpen] = useState<boolean | null>(null);
  useEffect(() => {
    if (!userId) return;
    try {
      setOpen(localStorage.getItem(guideKey(userId)) !== "hidden");
    } catch {
      setOpen(false);
    }
  }, [userId]);
  return [open, setOpen] as const;
}
