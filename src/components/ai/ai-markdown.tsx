// Renders AI-written markdown with information labels per statement (src/lib/claims.ts). Shared by the Growth Officer,
// specialist and team analyses, recovered answers and task AI work, so every AI answer is labelled the same way.
import { useId, useMemo, useState } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { useI18n } from "@/lib/i18n";
import type { MessageKey } from "@/lib/i18n/messages";
import {
  CLAIM_KINDS,
  claimCounts,
  claimStatements,
  markClaims,
  readMarker,
  type ClaimKind,
} from "@/lib/claims";
import {
  CLAIM_TONE,
  EvidenceLabel,
  EvidenceScopeProvider,
  type EvidenceScope,
} from "@/components/ai/evidence";
import { cn } from "@/lib/utils";
import { useOrg } from "@/lib/org-context";
import { answerLayout } from "@/lib/answer-layout";
import { ChevronDown } from "lucide-react";

const TONE = CLAIM_TONE;

export function ClaimLabel({
  kind,
  downgraded = false,
}: {
  kind: ClaimKind;
  downgraded?: boolean;
}) {
  const { t } = useI18n();
  return (
    <span
      title={downgraded ? t("cl.downgraded") : t(`cl.d.${kind}` as MessageKey)}
      className={cn(
        "mr-1 inline-flex items-center whitespace-nowrap rounded-full border px-1.5 py-px align-baseline text-2xs font-medium not-italic relative before:absolute before:-inset-y-1.5 before:inset-x-0",
        TONE[kind],
      )}
    >
      {t(`cl.${kind}` as MessageKey)}
      {downgraded ? " ?" : ""}
      {downgraded && <span className="sr-only"> ({t("cl.downgraded")})</span>}
    </span>
  );
}

/** `scope` names where cited records live (default: the active business); `asOf` is when the answer was written.
 * `summary` shows the conclusion and action sections first and folds the supporting analysis (`answer-layout.ts`). */
export function AiMarkdown({
  content,
  legend = true,
  asOf,
  scope,
  summary = false,
}: {
  content: string;
  legend?: boolean;
  asOf?: string | null;
  scope?: EvidenceScope;
  summary?: boolean;
}) {
  const { t } = useI18n();
  const marked = useMemo(() => markClaims(content), [content]);
  const statements = useMemo(() => claimStatements(content), [content]);
  const counts = useMemo(() => claimCounts(content), [content]);
  const used = CLAIM_KINDS.filter((k) => counts[k] > 0);
  const [open, setOpen] = useState(false);
  const [showSupport, setShowSupport] = useState(false);
  const layout = useMemo(() => (summary ? answerLayout(marked) : null), [summary, marked]);
  const o = useOrg();
  const effective: EvidenceScope | null =
    scope ?? (o.org && o.workspace ? { orgId: o.org.id, workspaceId: o.workspace.id } : null);
  const render = (text: string) => (
    <ReactMarkdown
      remarkPlugins={[remarkGfm]}
      skipHtml
      components={{
        code({ children, className, ...rest }) {
          const value = String(children ?? "");
          const m = !className ? readMarker(value) : null;
          if (m) {
            const st = m.index !== null ? statements[m.index] : undefined;
            return st ? (
              <EvidenceLabel kind={m.kind} downgraded={m.downgraded} text={st.text} />
            ) : (
              <ClaimLabel kind={m.kind} downgraded={m.downgraded} />
            );
          }
          return (
            <code className={className} {...rest}>
              {children}
            </code>
          );
        },
      }}
    >
      {text}
    </ReactMarkdown>
  );
  const supportId = useId();
  const body = (
    <>
      {layout ? (
        <>
          {render(layout.lead)}
          <div className="not-prose mt-4 rounded-md border border-border">
            <button
              type="button"
              aria-expanded={showSupport}
              aria-controls={supportId}
              onClick={() => setShowSupport((v) => !v)}
              className="flex min-h-11 w-full items-start gap-2 px-3 py-2.5 text-left text-xs"
            >
              <ChevronDown
                aria-hidden
                className={cn(
                  "mt-0.5 h-4 w-4 shrink-0 text-muted-foreground transition-transform",
                  showSupport && "rotate-180",
                )}
              />
              <span className="min-w-0">
                <span className="block font-medium text-foreground">
                  {showSupport ? t("cl.hideSupport") : t("cl.showSupport")}
                </span>
                <span className="mt-0.5 block text-muted-foreground">
                  {layout.support.map((x) => x.heading).join(" · ")}
                </span>
              </span>
            </button>
          </div>
          {showSupport && (
            <div id={supportId} className="mt-3">
              {render(layout.support.map((x) => x.body).join("\n\n"))}
            </div>
          )}
        </>
      ) : (
        render(marked)
      )}
      {legend && (
        <div className="not-prose mt-3 text-2xs text-muted-foreground">
          {used.length ? (
            <p className="flex flex-wrap items-center gap-1">
              <span>{t("cl.inAnswer")}</span>
              {used.map((k) => (
                <span key={k} className="inline-flex items-center gap-0.5">
                  <ClaimLabel kind={k} />
                  <span className="tabular-nums">×{counts[k]}</span>
                </span>
              ))}
              <button
                type="button"
                className="ml-1 underline"
                aria-expanded={open}
                onClick={() => setOpen((v) => !v)}
              >
                {t("cl.legend")}
              </button>
            </p>
          ) : null}
          {used.length ? <p className="mt-1">{t("evd.hint")}</p> : <p>{t("cl.unlabelled")}</p>}
          {open && (
            <dl className="mt-2 grid gap-1.5 sm:grid-cols-2">
              {CLAIM_KINDS.map((k) => (
                <div key={k} className="flex items-start gap-1.5">
                  <dt className="shrink-0">
                    <ClaimLabel kind={k} />
                  </dt>
                  <dd>{t(`cl.d.${k}` as MessageKey)}</dd>
                </div>
              ))}
            </dl>
          )}
        </div>
      )}
    </>
  );
  return effective ? (
    <EvidenceScopeProvider value={{ ...effective, asOf: asOf ?? effective.asOf ?? null }}>
      {body}
    </EvidenceScopeProvider>
  ) : (
    body
  );
}
