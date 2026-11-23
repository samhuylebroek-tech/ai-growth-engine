// Renders AI-written markdown with information labels per statement (src/lib/claims.ts). Shared by the Growth Officer,
// specialist and team analyses, recovered answers and task AI work, so every AI answer is labelled the same way.
import { useMemo, useState } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { useI18n } from "@/lib/i18n";
import type { MessageKey } from "@/lib/i18n/messages";
import { CLAIM_KINDS, claimCounts, claimStatements, markClaims, readMarker, type ClaimKind } from "@/lib/claims";
import { CLAIM_TONE, EvidenceLabel, EvidenceScopeProvider, type EvidenceScope } from "@/components/ai/evidence";
import { cn } from "@/lib/utils";
import { useOrg } from "@/lib/org-context";

const TONE = CLAIM_TONE;

export function ClaimLabel({ kind, downgraded = false }: { kind: ClaimKind; downgraded?: boolean }) {
  const { t } = useI18n();
  return (
    <span title={downgraded ? t("cl.downgraded") : t(`cl.d.${kind}` as MessageKey)} className={cn("mr-1 inline-flex items-center whitespace-nowrap rounded-full border px-1.5 py-px align-baseline text-[10px] font-medium not-italic", TONE[kind])}>
      {t(`cl.${kind}` as MessageKey)}{downgraded ? " ?" : ""}
      {downgraded && <span className="sr-only"> ({t("cl.downgraded")})</span>}
    </span>
  );
}

/** `scope` names where cited records live (default: the active business); `asOf` is when the answer was written. */
export function AiMarkdown({ content, legend = true, asOf, scope }: { content: string; legend?: boolean; asOf?: string | null; scope?: EvidenceScope }) {
  const { t } = useI18n();
  const marked = useMemo(() => markClaims(content), [content]);
  const statements = useMemo(() => claimStatements(content), [content]);
  const counts = useMemo(() => claimCounts(content), [content]);
  const used = CLAIM_KINDS.filter((k) => counts[k] > 0);
  const [open, setOpen] = useState(false);
  const o = useOrg();
  const effective: EvidenceScope | null = scope ?? (o.org && o.workspace ? { orgId: o.org.id, workspaceId: o.workspace.id } : null);
  const body = (
    <>
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        skipHtml
        components={{
          code({ children, className, ...rest }) {
            const text = String(children ?? "");
            const m = !className ? readMarker(text) : null;
            if (m) {
              const st = m.index !== null ? statements[m.index] : undefined;
              return st ? <EvidenceLabel kind={m.kind} downgraded={m.downgraded} text={st.text} /> : <ClaimLabel kind={m.kind} downgraded={m.downgraded} />;
            }
            return <code className={className} {...rest}>{children}</code>;
          },
        }}
      >
        {marked}
      </ReactMarkdown>
      {legend && (
        <div className="not-prose mt-3 text-[11px] text-muted-foreground">
          {used.length ? (
            <p className="flex flex-wrap items-center gap-1">
              <span>{t("cl.inAnswer")}</span>
              {used.map((k) => <span key={k} className="inline-flex items-center gap-0.5"><ClaimLabel kind={k} /><span className="tabular-nums">×{counts[k]}</span></span>)}
              <button type="button" className="ml-1 underline" aria-expanded={open} onClick={() => setOpen((v) => !v)}>{t("cl.legend")}</button>
            </p>
          ) : null}
          {used.length ? (
            <p className="mt-1">{t("evd.hint")}</p>
          ) : <p>{t("cl.unlabelled")}</p>}
          {open && (
            <dl className="mt-2 grid gap-1.5 sm:grid-cols-2">
              {CLAIM_KINDS.map((k) => <div key={k} className="flex items-start gap-1.5"><dt className="shrink-0"><ClaimLabel kind={k} /></dt><dd>{t(`cl.d.${k}` as MessageKey)}</dd></div>)}
            </dl>
          )}
        </div>
      )}
    </>
  );
  return effective ? <EvidenceScopeProvider value={{ ...effective, asOf: asOf ?? effective.asOf ?? null }}>{body}</EvidenceScopeProvider> : body;
}
