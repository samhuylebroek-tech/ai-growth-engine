// Renders AI-written markdown with information labels per statement (src/lib/claims.ts). Shared by the Growth Officer,
// specialist and team analyses, recovered answers and task AI work, so every AI answer is labelled the same way.
import { useMemo, useState } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { useI18n } from "@/lib/i18n";
import type { MessageKey } from "@/lib/i18n/messages";
import { CLAIM_KINDS, claimCounts, markClaims, readMarker, type ClaimKind } from "@/lib/claims";
import { cn } from "@/lib/utils";

const TONE: Record<ClaimKind, string> = {
  fact: "border-success/30 bg-success/10 text-success",
  calc: "border-primary/30 bg-primary/10 text-primary",
  estimate: "border-warning/30 bg-warning/10 text-warning",
  hypothesis: "border-warning/30 bg-warning/10 text-warning",
  recommendation: "border-border bg-secondary text-secondary-foreground",
  missing: "border-destructive/30 bg-destructive/10 text-destructive",
};

export function ClaimLabel({ kind, downgraded = false }: { kind: ClaimKind; downgraded?: boolean }) {
  const { t } = useI18n();
  return (
    <span title={downgraded ? t("cl.downgraded") : t(`cl.d.${kind}` as MessageKey)} className={cn("mr-1 inline-flex items-center whitespace-nowrap rounded-full border px-1.5 py-px align-baseline text-[10px] font-medium not-italic", TONE[kind])}>
      {t(`cl.${kind}` as MessageKey)}{downgraded ? " ?" : ""}
      {downgraded && <span className="sr-only"> ({t("cl.downgraded")})</span>}
    </span>
  );
}

export function AiMarkdown({ content, legend = true }: { content: string; legend?: boolean }) {
  const { t } = useI18n();
  const marked = useMemo(() => markClaims(content), [content]);
  const counts = useMemo(() => claimCounts(content), [content]);
  const used = CLAIM_KINDS.filter((k) => counts[k] > 0);
  const [open, setOpen] = useState(false);
  return (
    <>
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        skipHtml
        components={{
          code({ children, className, ...rest }) {
            const text = String(children ?? "");
            const m = !className ? readMarker(text) : null;
            if (m) return <ClaimLabel kind={m.kind} downgraded={m.downgraded} />;
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
}
