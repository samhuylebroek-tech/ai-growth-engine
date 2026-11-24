// Guided "getting to know your business": an overview of short steps, one step at a time, and the summary.
// Answers are confirmed business facts saved through save_business_answers (proposal 0091); nothing is stored twice.
// Skipping is remembered per person and business in this browser only; it never hides a question for others.
import { useEffect, useMemo, useState } from "react";
import { Link, useNavigate } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { ArrowRight, Check, ChevronDown, ChevronUp, Info, Loader2, Pencil } from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { growthDb, isNotInstalled } from "@/lib/pending-schema";
import { readFactPages } from "@/lib/facts-read";
import { useI18n } from "@/lib/i18n";
import type { MessageKey } from "@/lib/i18n/messages";
import { useOrg } from "@/lib/org-context";
import { can } from "@/lib/permissions";
import {
  SECTIONS,
  questionById,
  sectionQuestions,
  type Question,
  type SectionId,
} from "@/lib/onboarding/questions";
import {
  changedAnswers,
  decodeAnswer,
  draftsFromFacts,
  emptyDraft,
  encodeAnswer,
  hasContent,
  isVisible,
  optionsOf,
  overallProgress,
  savedAnswers,
  sectionProgress,
  understandingSummary,
  type AnswerFact,
  type Draft,
  type ProfileForSummary,
  type SummaryStatus,
} from "@/lib/onboarding/answers";
import { labelIn, labelsOf } from "@/lib/onboarding/labels";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { cn } from "@/lib/utils";

export type GuidedProfile = ProfileForSummary & {
  onboarding_completed_at?: string | null;
  updated_at?: string | null;
};
export type GuidedData = { profile: GuidedProfile; facts: AnswerFact[]; complete: boolean };

/** Profile plus every business fact of the active business (keyset pages; an incomplete read is reported). */
export function useGuidedData() {
  const o = useOrg();
  return useQuery({
    queryKey: ["onboarding-answers", o.org?.id, o.workspace?.id],
    enabled: !!o.org && !!o.workspace,
    queryFn: async (): Promise<GuidedData> => {
      const org = o.org?.id ?? "";
      const ws = o.workspace?.id ?? "";
      const [bp, facts] = await Promise.all([
        supabase
          .from("business_profiles")
          .select("*")
          .eq("org_id", org)
          .eq("workspace_id", ws)
          .maybeSingle(),
        readFactPages((cursor, size) => {
          const page = supabase
            .from("business_facts")
            .select("id,key,value,verified,source_type,source_ref,created_at")
            .eq("org_id", org)
            .eq("workspace_id", ws)
            .order("id")
            .limit(size);
          return cursor ? page.gt("id", cursor) : page;
        }),
      ]);
      if (bp.error) throw bp.error;
      return {
        profile: (bp.data ?? null) as GuidedProfile,
        facts: facts.rows as AnswerFact[],
        complete: facts.complete,
      };
    },
  });
}

const skipKey = (u: string, org: string, ws: string) => `ago-ob-skip:${u}:${org}:${ws}`;
function useSkipped() {
  const o = useOrg();
  const key = skipKey(o.userId, o.org?.id ?? "", o.workspace?.id ?? "");
  const [skipped, setSkipped] = useState<SectionId[]>([]);
  useEffect(() => {
    try {
      const v = JSON.parse(localStorage.getItem(key) ?? "[]");
      setSkipped(Array.isArray(v) ? v.filter((x): x is SectionId => SECTIONS.includes(x)) : []);
    } catch {
      setSkipped([]);
    }
  }, [key]);
  const set = (s: SectionId, on: boolean) =>
    setSkipped((cur) => {
      const next = on ? [...new Set([...cur, s])] : cur.filter((x) => x !== s);
      try {
        localStorage.setItem(key, JSON.stringify(next));
      } catch {
        /* private mode: skip is just not remembered */
      }
      return next;
    });
  return { skipped, set };
}

export function GuidedOverview({ data }: { data: GuidedData }) {
  const { t } = useI18n();
  const { skipped } = useSkipped();
  const progress = sectionProgress(data.facts);
  const overall = overallProgress(data.facts);
  const basicsDone = !!data.profile?.onboarding_completed_at;
  const next =
    overall.nextSection && !skipped.includes(overall.nextSection)
      ? overall.nextSection
      : (progress.find((p) => !p.done && !skipped.includes(p.section))?.section ?? null);
  return (
    <div className="mx-auto max-w-3xl">
      <h1 className="text-3xl font-semibold">{t("ob.title")}</h1>
      <p className="mt-3 max-w-2xl text-muted-foreground">{t("ob.intro")}</p>
      <div className="mt-6">
        <p className="text-sm font-medium tabular-nums">
          {t("ob.progress", { answered: overall.answered, total: overall.total })}
        </p>
        <div
          className="mt-2 h-2 overflow-hidden rounded-full bg-muted"
          role="progressbar"
          aria-label={t("ob.progress", { answered: overall.answered, total: overall.total })}
          aria-valuemin={0}
          aria-valuemax={overall.total}
          aria-valuenow={overall.answered}
        >
          <div
            className="h-full rounded-full bg-primary"
            style={{
              width: `${overall.total ? Math.round((overall.answered / overall.total) * 100) : 0}%`,
            }}
          />
        </div>
        {!data.complete && (
          <p role="status" className="mt-2 text-xs text-muted-foreground">
            {t("ob.readFailed")}
          </p>
        )}
      </div>
      <ol className="mt-8 divide-y divide-border rounded-xl border border-border bg-card">
        <li className="flex flex-wrap items-center gap-3 p-4">
          <StepMark done={basicsDone} />
          <div className="min-w-0 flex-1">
            <p className="font-medium">{t("ob.basics.title")}</p>
            <p className="text-sm text-muted-foreground">{t("ob.basics.intro")}</p>
          </div>
          <span className="text-xs text-muted-foreground">
            {basicsDone ? t("ob.basics.done") : t("ob.basics.todo")}
          </span>
          <Button size="sm" variant="outline" asChild>
            <Link to="/app/onboarding" search={{ section: "basics" }}>
              {basicsDone ? t("ob.edit") : t("ob.start")}
            </Link>
          </Button>
        </li>
        {progress.map((p) => {
          const status = p.done
            ? t("ob.status.done")
            : skipped.includes(p.section) && p.coreAnswered === 0
              ? t("ob.status.skipped")
              : p.coreAnswered
                ? t("ob.status.partly", { done: p.coreAnswered, total: p.coreTotal })
                : t("ob.status.todo");
          return (
            <li key={p.section} className="flex flex-wrap items-center gap-3 p-4">
              <StepMark done={p.done} />
              <div className="min-w-0 flex-1">
                <p className="font-medium">{t(`ob.section.${p.section}.title` as MessageKey)}</p>
                <p className="text-sm text-muted-foreground">
                  {t(`ob.section.${p.section}.intro` as MessageKey)}
                </p>
              </div>
              <span className="text-xs text-muted-foreground">{status}</span>
              <Button size="sm" variant={p.section === next ? "default" : "outline"} asChild>
                <Link to="/app/onboarding" search={{ section: p.section }}>
                  {p.answered
                    ? t("ob.edit")
                    : p.section === next
                      ? t("ob.start")
                      : t("ob.basics.open")}
                </Link>
              </Button>
            </li>
          );
        })}
      </ol>
      <div className="mt-6 flex justify-end">
        <Button variant="link" asChild>
          <Link to="/app/onboarding" search={{ section: "summary" }}>
            {t("ob.summaryLink")} <ArrowRight />
          </Link>
        </Button>
      </div>
    </div>
  );
}

function StepMark({ done }: { done: boolean }) {
  return (
    <span
      aria-hidden
      className={cn(
        "flex h-6 w-6 shrink-0 items-center justify-center rounded-full border",
        done
          ? "border-primary bg-primary text-primary-foreground"
          : "border-border text-muted-foreground",
      )}
    >
      {done ? <Check className="h-3.5 w-3.5" /> : null}
    </span>
  );
}

function knownHint(q: Question, data: GuidedData): { value: string; status: SummaryStatus } | null {
  const p = data.profile;
  const list = (v: unknown) =>
    Array.isArray(v)
      ? v.filter((x): x is string => typeof x === "string" && !!x.trim()).join(", ")
      : "";
  const fromProfile =
    q.hint === "audiences"
      ? list(p?.audiences)
      : q.hint === "markets"
        ? list(p?.markets)
        : q.hint === "objectives"
          ? list(p?.objectives)
          : "";
  if (fromProfile) return { value: fromProfile, status: "confirmed" };
  const factKey =
    q.hint === "audiences"
      ? "target audiences"
      : q.hint === "channels"
        ? "marketing channels"
        : q.hint === "markets"
          ? "markets"
          : null;
  if (!factKey) return null;
  const f = data.facts
    .filter((x) => x.key.trim().toLowerCase() === factKey && x.value.trim())
    .sort((a, b) => Number(b.verified) - Number(a.verified))[0];
  return f
    ? {
        value: f.value.trim(),
        status: f.verified
          ? "confirmed"
          : f.source_type === "ai_assumption"
            ? "assumption"
            : "unconfirmed",
      }
    : null;
}

export function SectionForm({ section, data }: { section: SectionId; data: GuidedData }) {
  const { t, locale } = useI18n();
  const o = useOrg();
  const qc = useQueryClient();
  const navigate = useNavigate();
  const editable = can(o.workspaceRole, "profile.confirm");
  const { set: setSkip } = useSkipped();
  const saved = useMemo(() => savedAnswers(data.facts), [data.facts]);
  const [drafts, setDrafts] = useState<Record<string, Draft>>(() =>
    draftsFromFacts(data.facts, labelsOf),
  );
  const questions = sectionQuestions(section);
  const optional = questions.filter((q) => !q.core);
  const [more, setMore] = useState(() => optional.some((q) => saved.has(q.key)));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const index = SECTIONS.indexOf(section);
  const nextSection = SECTIONS[index + 1];
  const goNext = () =>
    navigate({ to: "/app/onboarding", search: { section: nextSection ?? "summary" } });
  const update = (id: string, patch: Partial<Draft>) =>
    setDrafts((d) => ({ ...d, [id]: { ...(d[id] ?? emptyDraft()), ...patch } }));

  async function save() {
    if (!o.workspace || busy || !editable) return;
    const rows = changedAnswers(section, drafts, saved, labelIn(locale));
    setError("");
    if (!rows.length) {
      setSkip(section, false);
      toast(t("ob.unchanged"));
      goNext();
      return;
    }
    setBusy(true);
    try {
      const r = await growthDb.rpc("save_business_answers", {
        _workspace: o.workspace.id,
        _answers: rows,
      });
      if (r.error) {
        if (r.error.code === "AN409") {
          const fresh = (await qc.fetchQuery({
            queryKey: ["onboarding-answers", o.org?.id, o.workspace.id],
            staleTime: 0,
          })) as GuidedData | undefined;
          if (fresh) setDrafts(draftsFromFacts(fresh.facts, labelsOf));
          setError(t("ob.changed"));
        } else
          setError(
            isNotInstalled(r.error)
              ? t("ob.unavailable")
              : r.error.code === "42501"
                ? t("ob.forbidden")
                : t("ob.failed"),
          );
        return;
      }
      setSkip(section, false);
      await qc.invalidateQueries();
      toast.success(t("ob.saved"));
      goNext();
    } catch {
      setError(t("ob.failed"));
    } finally {
      setBusy(false);
    }
  }
  function skip() {
    setSkip(section, true);
    goNext();
  }

  const visible = (q: Question) => isVisible(q, drafts);
  return (
    <div className="mx-auto max-w-3xl">
      <p className="text-xs font-medium text-muted-foreground">
        {t("ob.stepOf", { n: index + 1, total: SECTIONS.length })}
      </p>
      <h1 className="mt-1 text-3xl font-semibold">
        {t(`ob.section.${section}.title` as MessageKey)}
      </h1>
      <p className="mt-3 max-w-2xl text-muted-foreground">
        {t(`ob.section.${section}.intro` as MessageKey)}
      </p>
      {!editable && (
        <p role="note" className="mt-4 rounded-md border border-border bg-muted p-3 text-sm">
          {t("ob.readOnly")}
        </p>
      )}
      {error && (
        <div
          role="alert"
          className="mt-4 rounded-md border border-destructive/30 bg-destructive/5 p-3 text-sm text-destructive"
        >
          {error}
        </div>
      )}
      <div className="mt-8 space-y-8">
        {questions
          .filter((q) => q.core && visible(q))
          .map((q) => (
            <QuestionField
              key={q.id}
              q={q}
              draft={drafts[q.id] ?? emptyDraft()}
              drafts={drafts}
              data={data}
              disabled={!editable || busy}
              onChange={(p) => update(q.id, p)}
            />
          ))}
      </div>
      {optional.some(visible) && (
        <div className="mt-8 border-t border-border pt-4">
          <Button
            variant="ghost"
            size="sm"
            className="px-0"
            aria-expanded={more}
            onClick={() => setMore((v) => !v)}
          >
            {more ? <ChevronUp /> : <ChevronDown />}
            {more ? t("ob.fewer") : t("ob.more")}
          </Button>
          {more && (
            <div className="mt-6 space-y-8">
              {optional.filter(visible).map((q) => (
                <QuestionField
                  key={q.id}
                  q={q}
                  draft={drafts[q.id] ?? emptyDraft()}
                  drafts={drafts}
                  data={data}
                  disabled={!editable || busy}
                  onChange={(p) => update(q.id, p)}
                />
              ))}
            </div>
          )}
        </div>
      )}
      <div className="mt-10 flex flex-col-reverse gap-3 border-t border-border pt-5 sm:flex-row sm:items-center sm:justify-between">
        <Button variant="ghost" asChild>
          <Link to="/app/onboarding">{t("ob.back")}</Link>
        </Button>
        <div className="flex flex-col gap-2 sm:flex-row">
          {editable && (
            <Button variant="outline" onClick={skip} disabled={busy}>
              {t("ob.skip")}
            </Button>
          )}
          {editable ? (
            <Button onClick={save} disabled={busy}>
              {busy ? <Loader2 className="animate-spin" /> : <Check />}
              {nextSection ? t("ob.save") : t("ob.saveLast")}
            </Button>
          ) : (
            <Button onClick={goNext}>
              {t("ob.continue")} <ArrowRight />
            </Button>
          )}
        </div>
      </div>
    </div>
  );
}

function QuestionField({
  q,
  draft,
  drafts,
  data,
  disabled,
  onChange,
}: {
  q: Question;
  draft: Draft;
  drafts: Record<string, Draft>;
  data: GuidedData;
  disabled: boolean;
  onChange: (p: Partial<Draft>) => void;
}) {
  const { t } = useI18n();
  const id = `ob-${q.id}`;
  const label = t(`ob.q.${q.id}.label` as MessageKey);
  const why = t(`ob.q.${q.id}.why` as MessageKey);
  const hint = knownHint(q, data);
  const source = q.optionsFrom ?? q.id;
  const opts = optionsOf(q, drafts);
  const toggle = (o: string) => {
    if (q.kind === "single") onChange({ choices: draft.choices[0] === o ? [] : [o] });
    else
      onChange({
        choices: draft.choices.includes(o)
          ? draft.choices.filter((x) => x !== o)
          : [...draft.choices, o],
      });
  };
  return (
    <fieldset aria-describedby={`${id}-why`} className="min-w-0">
      <legend className="flex flex-wrap items-center gap-2 text-base font-medium">
        {label}
        {!q.core && (
          <span className="rounded-full border border-border px-2 py-0.5 text-2xs font-normal text-muted-foreground">
            {t("ob.optional")}
          </span>
        )}
      </legend>
      <p id={`${id}-why`} className="mt-1 flex items-start gap-1.5 text-sm text-muted-foreground">
        <Info className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden />
        <span>
          <span className="sr-only">{t("ob.why")}: </span>
          {why}
        </span>
      </p>
      {hint && (
        <div className="mt-3 flex flex-wrap items-center gap-2 rounded-md border border-border bg-muted/50 p-2.5 text-sm">
          <span className="min-w-0 flex-1 break-words">
            {t("ob.known", { value: hint.value })}{" "}
            <span className="text-xs text-muted-foreground">
              ({t(`ob.known.${hint.status}` as MessageKey)})
            </span>
          </span>
          {q.kind === "text" && !draft.text.trim() && !disabled && (
            <Button size="sm" variant="outline" onClick={() => onChange({ text: hint.value })}>
              {t("ob.useKnown")}
            </Button>
          )}
        </div>
      )}
      {q.kind === "text" ? (
        <Textarea
          id={id}
          aria-label={label}
          className="mt-3"
          rows={3}
          maxLength={1000}
          placeholder={t("ob.textPlaceholder")}
          value={draft.text}
          disabled={disabled}
          onChange={(e) => onChange({ text: e.target.value })}
        />
      ) : (
        <>
          <div
            role={q.kind === "single" ? "radiogroup" : "group"}
            aria-label={label}
            className="mt-3 flex flex-wrap gap-2"
          >
            {opts.map((o) => {
              const on = draft.choices.includes(o);
              return (
                <button
                  key={o}
                  type="button"
                  disabled={disabled}
                  onClick={() => toggle(o)}
                  {...(q.kind === "single"
                    ? { role: "radio", "aria-checked": on }
                    : { "aria-pressed": on })}
                  className={cn(
                    "min-h-10 rounded-full border px-3.5 py-1.5 text-sm transition-colors disabled:opacity-60",
                    on
                      ? "border-primary bg-primary text-primary-foreground"
                      : "border-border bg-background hover:bg-muted",
                  )}
                >
                  {t(`ob.o.${source}.${o}` as MessageKey)}
                </button>
              );
            })}
          </div>
          {q.kind === "multi" && q.other && (
            <div className="mt-3 space-y-1.5">
              <Label htmlFor={`${id}-other`} className="text-xs text-muted-foreground">
                {t("ob.other")}
              </Label>
              <Textarea
                id={`${id}-other`}
                rows={2}
                maxLength={500}
                value={draft.other}
                disabled={disabled}
                onChange={(e) => onChange({ other: e.target.value })}
              />
            </div>
          )}
          {q.kind === "single" && draft.other && (
            <p className="mt-2 text-xs text-muted-foreground">{draft.other}</p>
          )}
        </>
      )}
      {hasContent(q, draft) && !disabled && (
        <Button
          variant="link"
          size="sm"
          className="mt-1 h-auto px-0 text-xs text-muted-foreground"
          onClick={() => onChange(emptyDraft())}
        >
          {t("ob.clear")}
        </Button>
      )}
    </fieldset>
  );
}

const TONE: Record<SummaryStatus, string> = {
  confirmed: "border-success/30 bg-success/10 text-success",
  unconfirmed: "border-warning/30 bg-warning/10 text-warning",
  assumption: "border-warning/30 bg-warning/10 text-warning",
};

export function UnderstandingSummary({
  data,
  compact = false,
}: {
  data: GuidedData;
  compact?: boolean;
}) {
  const { t } = useI18n();
  const o = useOrg();
  const editable = can(o.workspaceRole, "profile.confirm");
  const topics = understandingSummary(data.profile, data.facts);
  const known = topics.filter((x) => x.items.length).length;
  const { locale } = useI18n();
  // Choices are shown in the reader's language, whatever language they were saved in; own text stays as written.
  const value = (source: string, v: string) => {
    if (source === "profile:monthly_budget_eur") return t("ob.sum.budget", { value: v });
    const q = source.startsWith("question:") ? questionById(source.slice(9)) : undefined;
    return q && q.kind !== "text"
      ? encodeAnswer(q, decodeAnswer(q, v, labelsOf), labelIn(locale)) || v
      : v;
  };
  return (
    <section aria-labelledby="ob-summary-title" className={cn(!compact && "mx-auto max-w-3xl")}>
      {compact ? (
        <h2 id="ob-summary-title" className="text-base font-semibold">
          {t("ob.sum.title")}
        </h2>
      ) : (
        <h1 id="ob-summary-title" className="text-3xl font-semibold">
          {t("ob.sum.title")}
        </h1>
      )}
      <p className={cn("max-w-2xl text-muted-foreground", compact ? "mt-1 text-sm" : "mt-3")}>
        {editable ? t("ob.sum.intro") : t("ob.sum.introRead")}
      </p>
      <p className="mt-3 text-sm font-medium tabular-nums">
        {t("ob.sum.counts", { known, total: topics.length, missing: topics.length - known })}
      </p>
      {!data.complete && (
        <p role="status" className="mt-1 text-xs text-muted-foreground">
          {t("ob.readFailed")}
        </p>
      )}
      <dl className="mt-5 divide-y divide-border rounded-xl border border-border bg-card">
        {topics.map((topic) => (
          <div
            key={topic.topic}
            className="grid gap-2 p-4 sm:grid-cols-[200px_minmax(0,1fr)_auto] sm:items-start sm:gap-4"
          >
            <dt className="text-sm font-medium">
              {t(`ob.sum.topic.${topic.topic}` as MessageKey)}
            </dt>
            <dd className="min-w-0 space-y-2">
              {topic.items.length ? (
                topic.items.slice(0, 6).map((item) => (
                  <div key={item.source} className="flex flex-wrap items-start gap-2">
                    <span
                      className={cn(
                        "inline-flex shrink-0 rounded-full border px-2 py-0.5 text-2xs font-medium",
                        TONE[item.status],
                      )}
                    >
                      {t(`ob.sum.status.${item.status}` as MessageKey)}
                    </span>
                    <span className="min-w-0 flex-1 break-words text-sm">
                      {item.source.startsWith("question:") && (
                        <span className="block text-xs text-muted-foreground">
                          {t(`ob.q.${item.source.slice(9)}.label` as MessageKey)}
                        </span>
                      )}
                      <span className="whitespace-pre-line">{value(item.source, item.value)}</span>
                    </span>
                  </div>
                ))
              ) : (
                <span className="text-sm text-muted-foreground">{t("ob.sum.missing")}</span>
              )}
            </dd>
            {editable && (
              <dd>
                <Button size="sm" variant="ghost" asChild>
                  <Link to="/app/onboarding" search={{ section: topic.edit }}>
                    <Pencil />
                    {topic.items.length ? t("ob.sum.fix") : t("ob.sum.add")}
                  </Link>
                </Button>
              </dd>
            )}
          </div>
        ))}
      </dl>
    </section>
  );
}
