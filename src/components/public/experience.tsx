import { useState } from "react";
import { Link } from "@tanstack/react-router";
import {
  ArrowRight,
  Check,
  ChevronRight,
  FileText,
  Mail,
  Megaphone,
  MessageSquare,
  Search,
  ShieldCheck,
  Sparkles,
  Users,
  Zap,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { LanguagePicker } from "@/components/app/language-picker";
import { useI18n } from "@/lib/i18n";
import cover from "@/assets/growth-engine-cover.jpg";

export function PublicExperience() {
  const { t } = useI18n();
  const [step, setStep] = useState<0 | 1 | 2 | 3 | 4>(0);
  const steps = [0, 1, 2, 3, 4] as const;
  const start = (
    <Button size="lg" className="h-auto min-h-12 whitespace-normal" asChild>
      <Link to="/auth" search={{ redirect: undefined, mode: "signup" }}>
        {t("site.cta")}
        <ArrowRight />
      </Link>
    </Button>
  );
  return (
    <div className="min-h-screen bg-background text-foreground">
      <nav
        aria-label={t("pages.sh.mainNav")}
        className="mx-auto flex min-h-20 max-w-7xl items-center justify-between gap-2 px-5 md:px-10"
      >
        <Link to="/" className="flex min-w-0 items-center gap-2 text-sm font-bold sm:text-base">
          <Zap className="size-5 shrink-0 text-primary" />
          AI Growth Engine
        </Link>
        <div className="hidden items-center gap-5 text-sm lg:flex">
          <a href="#team" className="py-3 hover:text-primary">
            {t("site.nav.work")}
          </a>
          <a href="#campaign" className="py-3 hover:text-primary">
            {t("site.nav.journey")}
          </a>
          <Link to="/pricing" className="py-3 hover:text-primary">
            {t("pages.pub.plans")}
          </Link>
        </div>
        <div className="flex shrink-0 items-center gap-1 sm:gap-3">
          <LanguagePicker />
          <Button variant="outline" size="sm" asChild>
            <Link to="/auth" search={{ redirect: undefined }}>
              {t("pages.pub.signIn")}
            </Link>
          </Button>
        </div>
      </nav>
      <header className="relative isolate overflow-hidden">
        <img
          src={cover}
          width={1536}
          height={1024}
          alt={t("pages.pub.coverAlt")}
          className="absolute inset-0 -z-20 h-full w-full object-cover"
        />
        <div className="absolute inset-0 -z-10 bg-background/85" />
        <div className="mx-auto max-w-7xl px-5 py-12 md:px-10 md:py-14">
          <p className="mb-4 flex items-center gap-2 text-sm font-medium text-primary">
            <Sparkles className="size-4" />
            {t("site.kicker")}
          </p>
          <h1 className="max-w-3xl text-4xl font-semibold leading-tight md:text-5xl xl:text-6xl">
            AI Growth Engine
          </h1>
          <p className="mt-5 max-w-2xl text-2xl font-medium leading-snug sm:text-3xl">
            {t("site.promise")}
          </p>
          <p className="mt-4 max-w-xl text-base leading-relaxed text-muted-foreground">
            {t("site.intro")}
          </p>
          <div className="mt-7 flex flex-wrap items-center gap-3">
            {start}
            <Button
              variant="outline"
              size="lg"
              className="h-auto min-h-12 whitespace-normal"
              asChild
            >
              <a href="#campaign">
                {t("site.see")}
                <ChevronRight />
              </a>
            </Button>
          </div>
          <p className="mt-4 text-sm text-muted-foreground">{t("pages.pub.trial")}</p>
        </div>
      </header>
      <section id="activities" className="border-b border-border">
        <div className="mx-auto max-w-7xl px-5 py-12 md:px-10 md:py-16">
          <h2 className="max-w-3xl text-2xl font-semibold sm:text-3xl">
            {t("site.channels.title")}
          </h2>
          <p className="mt-4 max-w-2xl text-base leading-relaxed text-muted-foreground">
            {t("site.channels.intro")}
          </p>
          <div className="mt-9 grid gap-8 sm:grid-cols-2 xl:grid-cols-4">
            {[
              { key: "ads", icon: Megaphone },
              { key: "content", icon: FileText },
              { key: "email", icon: Mail },
              { key: "sales", icon: Users },
            ].map(({ key, icon: Icon }) => (
              <div key={key} className="min-w-0">
                <Icon className="mb-4 size-6 text-primary" />
                <h3 className="text-lg font-semibold">{t(`site.${key}.t` as "site.ads.t")}</h3>
                <p className="mt-3 text-sm leading-relaxed text-muted-foreground">
                  {t(`site.${key}.d` as "site.ads.d")}
                </p>
              </div>
            ))}
          </div>
        </div>
      </section>
      <section id="campaign" className="scroll-mt-6 bg-surface">
        <div className="mx-auto max-w-7xl px-5 py-12 md:px-10 md:py-16">
          <h2 className="max-w-3xl text-2xl font-semibold sm:text-3xl">
            {t("site.journey.title")}
          </h2>
          <p className="mt-3 text-sm text-muted-foreground">{t("site.journey.label")}</p>
          <div className="mt-8 border-b border-border pb-5">
            <p className="text-sm text-muted-foreground">{t("site.journey.business")}</p>
            <p className="mt-1 text-xl font-semibold">{t("site.journey.goal")}</p>
          </div>
          <div
            role="tablist"
            aria-label={t("site.nav.journey")}
            className="mt-5 flex flex-wrap gap-2"
          >
            {steps.map((n) => (
              <Button
                key={n}
                role="tab"
                id={`campaign-step-${n}`}
                aria-controls="campaign-stage"
                aria-selected={step === n}
                variant={step === n ? "default" : "ghost"}
                className="h-auto min-h-11 whitespace-normal"
                onClick={() => setStep(n)}
                onKeyDown={(e) => {
                  if (!["ArrowRight", "ArrowLeft", "Home", "End"].includes(e.key)) return;
                  e.preventDefault();
                  const next =
                    e.key === "Home"
                      ? 0
                      : e.key === "End"
                        ? 4
                        : (n + (e.key === "ArrowRight" ? 1 : 4)) % 5;
                  const selected = steps[next];
                  if (selected === undefined) return;
                  setStep(selected);
                  document.getElementById(`campaign-step-${selected}`)?.focus();
                }}
              >
                {n + 1}. {t(`site.step.${n}.t`)}
              </Button>
            ))}
          </div>
          <div
            id="campaign-stage"
            role="tabpanel"
            aria-labelledby={`campaign-step-${step}`}
            className="mt-7 min-h-64 max-w-3xl pb-4 sm:min-h-52"
          >
            <h3 className="text-xl font-semibold">{t(`site.step.${step}.t`)}</h3>
            <p className="mt-4 text-base leading-relaxed text-muted-foreground">
              {t(`site.step.${step}.d`)}
            </p>
            <p className="mt-5 flex items-start gap-3 text-sm leading-relaxed">
              <Check className="mt-0.5 size-5 shrink-0 text-primary" />
              {t(`site.step.${step}.out`)}
            </p>
          </div>
        </div>
      </section>
      <section id="team" className="mx-auto max-w-7xl scroll-mt-6 px-5 py-12 md:px-10 md:py-16">
        <p className="mb-4 flex items-center gap-2 text-sm font-medium text-primary">
          <Sparkles className="size-5" />
          Growth Officer
        </p>
        <h2 className="max-w-3xl text-2xl font-semibold sm:text-3xl">{t("site.team.title")}</h2>
        <p className="mt-4 max-w-3xl text-base leading-relaxed text-muted-foreground">
          {t("site.team.intro")}
        </p>
        <div className="mt-8 grid gap-7 md:grid-cols-3">
          {[
            { key: "marketing", icon: Megaphone },
            { key: "sales", icon: MessageSquare },
            { key: "analysis", icon: Search },
          ].map(({ key, icon: Icon }) => (
            <div key={key} className="border-t border-border pt-5">
              <Icon className="mb-3 size-5 text-primary" />
              <h3 className="font-semibold">{t(`site.team.${key}` as "site.team.marketing")}</h3>
              <p className="mt-2 text-sm leading-relaxed text-muted-foreground">
                {t(`site.team.${key}.d` as "site.team.marketing.d")}
              </p>
            </div>
          ))}
        </div>
      </section>
      <section className="border-y border-border bg-accent/40">
        <div className="mx-auto max-w-7xl px-5 py-10 md:px-10">
          <ShieldCheck className="mb-4 size-7 text-primary" />
          <h2 className="text-2xl font-semibold">{t("site.control.title")}</h2>
          <p className="mt-4 max-w-3xl text-base leading-relaxed text-muted-foreground">
            {t("site.control.d")}
          </p>
        </div>
      </section>
      <section className="mx-auto max-w-7xl px-5 py-12 md:px-10 md:py-16">
        <h2 className="max-w-3xl text-2xl font-semibold sm:text-3xl">{t("site.use.title")}</h2>
        <div className="mt-8 grid gap-8 md:grid-cols-3">
          {["service", "shop", "team"].map((key) => (
            <div key={key}>
              <h3 className="text-lg font-semibold">
                {t(`site.use.${key}.t` as "site.use.service.t")}
              </h3>
              <p className="mt-3 text-sm leading-relaxed text-muted-foreground">
                {t(`site.use.${key}.d` as "site.use.service.d")}
              </p>
            </div>
          ))}
        </div>
      </section>
      <section className="border-y border-border bg-surface">
        <div className="mx-auto max-w-7xl px-5 py-12 md:px-10">
          <h2 className="text-2xl font-semibold">{t("site.pricing.title")}</h2>
          <p className="mt-4 max-w-3xl text-base leading-relaxed text-muted-foreground">
            {t("site.pricing.d")}
          </p>
          <Button variant="outline" className="mt-6 h-auto min-h-11 whitespace-normal" asChild>
            <Link to="/pricing">
              {t("site.pricing.link")}
              <ArrowRight />
            </Link>
          </Button>
        </div>
      </section>
      <section id="questions" className="mx-auto max-w-7xl px-5 py-12 md:px-10 md:py-16">
        <h2 className="text-2xl font-semibold sm:text-3xl">{t("site.faq.title")}</h2>
        <div className="mt-7 max-w-3xl">
          {steps.map((n) => (
            <details key={n} className="border-b border-border py-5">
              <summary className="min-h-6 cursor-pointer pr-3 text-base font-medium">
                {t(`site.faq.${n}.q`)}
              </summary>
              <p className="mt-4 text-sm leading-relaxed text-muted-foreground">
                {t(`site.faq.${n}.a`)}
              </p>
            </details>
          ))}
        </div>
      </section>
      <section className="border-t border-border">
        <div className="mx-auto max-w-7xl px-5 py-12 md:px-10">
          <h2 className="text-2xl font-semibold sm:text-3xl">{t("site.close.title")}</h2>
          <p className="mb-6 mt-3 text-base text-muted-foreground">{t("site.close.d")}</p>
          {start}
        </div>
      </section>
      <footer className="mx-auto flex max-w-7xl flex-wrap items-center justify-between gap-4 border-t border-border px-5 py-7 text-sm text-muted-foreground md:px-10">
        <span>© 2026 AI Growth Engine</span>
        <div className="flex gap-5">
          <Link className="py-2" to="/pricing">
            {t("pages.pub.plans")}
          </Link>
          <a className="py-2" href="#questions">
            {t("site.nav.faq")}
          </a>
        </div>
      </footer>
    </div>
  );
}
