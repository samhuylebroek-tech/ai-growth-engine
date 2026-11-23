import { useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { useQueryClient } from "@tanstack/react-query";
import { ClipboardCheck, Check, X, Eye } from "lucide-react";
import { toast } from "sonner";
import { reviewContent } from "@/lib/ai.functions";
import {
  DIMENSION_KEYS,
  applySuggestion,
  type Dimension,
  type Review,
  type Suggestion,
} from "@/lib/content-review";
import { diffLines } from "@/lib/content";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Checkbox } from "@/components/ui/checkbox";
import { useI18n } from "@/lib/i18n";
import { MESSAGES, type MessageKey } from "@/lib/i18n/messages";

const STATUS: Record<
  string,
  { label: string; variant: "default" | "secondary" | "destructive" | "outline" }
> = {
  verified: { label: "Verified", variant: "default" },
  partially_supported: { label: "Partially supported", variant: "secondary" },
  unsupported: { label: "Unsupported", variant: "destructive" },
  contradictory: { label: "Contradictory", variant: "destructive" },
  needs_review: { label: "Needs review", variant: "outline" },
};
const SEV = ["critical", "important", "minor"] as const;

type Version = { id: string; version_no: number };

/** User-started quality review. Suggestions only change the working draft; saving remains an explicit new version. */
export function ReviewPanel({
  orgId,
  wsId,
  assetId,
  draft,
  versions,
  onApply,
}: {
  orgId: string;
  wsId: string;
  assetId: string;
  draft: string;
  versions: Version[];
  onApply: (text: string) => void;
}) {
  const run = useServerFn(reviewContent);
  const qc = useQueryClient();
  const { t: tx } = useI18n();
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [dims, setDims] = useState<Dimension[]>(["factual", "quality", "channel"]);
  const [target, setTarget] = useState<string>("draft");
  const [requestKey, setRequestKey] = useState(() => crypto.randomUUID());
  const [review, setReview] = useState<Review | null>(null);
  const [done, setDone] = useState<Record<number, "applied" | "rejected">>({});
  const [picked, setPicked] = useState<number[]>([]);
  const [preview, setPreview] = useState<number | null>(null);
  const fresh = () => setRequestKey(crypto.randomUUID());
  const submit = async () => {
    if (!dims.length) return void toast.error(tx("marketing.cs.chooseCheck"));
    if (target === "draft" && !draft.trim())
      return void toast.error(tx("marketing.cs.writeBeforeReview"));
    setBusy(true);
    try {
      const r = await run({
        data: {
          orgId,
          workspaceId: wsId,
          assetId,
          requestKey,
          versionId: target === "draft" ? null : target,
          dimensions: dims,
        },
      });
      if (!r.ok) return void toast.error(r.error);
      setReview(r.data.review);
      setDone({});
      setPicked([]);
      fresh();
      toast.success(tx("marketing.cs.reviewReady", { n: r.data.credits }));
      qc.invalidateQueries({ queryKey: ["credits"] });
    } catch {
      toast.error(tx("marketing.cs.unconfirmed"));
    } finally {
      setBusy(false);
    }
  };
  const apply = (idxs: number[]) => {
    if (!review) return;
    let text = draft;
    const ok: number[] = [];
    const failed: number[] = [];
    for (const i of idxs) {
      const next = applySuggestion(text, review.suggestions[i]!);
      if (next === null) failed.push(i);
      else {
        text = next;
        ok.push(i);
      }
    }
    if (ok.length) {
      onApply(text);
      setDone((d) => ({ ...d, ...Object.fromEntries(ok.map((i) => [i, "applied" as const])) }));
    }
    setPicked([]);
    setPreview(null);
    if (failed.length) toast.error(tx("marketing.cs.notMatch", { n: failed.length }));
    else if (ok.length) toast.success(tx("marketing.cs.applied"));
  };
  if (!open)
    return (
      <Button variant="outline" size="sm" onClick={() => setOpen(true)}>
        <ClipboardCheck className="mr-1 h-4 w-4" />
        {tx("marketing.cs.qualityReview")}
      </Button>
    );
  const pending = review?.suggestions.map((s, i) => ({ s, i })).filter(({ i }) => !done[i]) ?? [];
  return (
    <div className="space-y-3 rounded-md border bg-muted/30 p-3">
      <div className="flex items-center justify-between">
        <h3 className="flex items-center gap-1 text-sm font-semibold">
          <ClipboardCheck className="h-4 w-4" />
          {tx("marketing.cs.qualityReview")}
        </h3>
        <Button size="sm" variant="ghost" onClick={() => setOpen(false)}>
          {tx("marketing.cs.close")}
        </Button>
      </div>
      <p className="text-xs text-muted-foreground">{tx("marketing.cs.reviewIntro")}</p>
      <div className="grid gap-2">
        {DIMENSION_KEYS.map((k) => (
          <label key={k} className="flex items-start gap-2 text-sm">
            <Checkbox
              checked={dims.includes(k)}
              onCheckedChange={(c) => {
                setDims((d) => (c ? [...d, k] : d.filter((x) => x !== k)));
                fresh();
              }}
              aria-label={tx(`marketing.cs.dim.${k}`)}
            />
            <span>
              <span className="font-medium">{tx(`marketing.cs.dim.${k}`)}</span>
              <span className="block text-xs text-muted-foreground">
                {tx(`marketing.cs.dimm.${k}`)}
              </span>
            </span>
          </label>
        ))}
      </div>
      <div className="flex flex-wrap items-center gap-2">
        <select
          aria-label={tx("marketing.cs.reviewTarget")}
          className="h-9 rounded-md border border-input bg-background px-2 text-sm"
          value={target}
          onChange={(e) => {
            setTarget(e.target.value);
            fresh();
          }}
        >
          <option value="draft">{tx("marketing.cs.currentDraft")}</option>
          {versions.map((v) => (
            <option key={v.id} value={v.id}>
              {tx("marketing.cs.savedVersion", { n: v.version_no })}
            </option>
          ))}
        </select>
        <Button onClick={submit} disabled={busy}>
          {busy ? tx("marketing.cs.reviewing") : tx("marketing.cs.runReview")}
        </Button>
      </div>
      {review && (
        <div className="space-y-4 rounded-md border bg-background p-3 text-sm">
          <div>
            <Badge variant="outline">{tx("marketing.cs.aiJudgment")}</Badge>
            <p className="mt-1">{review.overall}</p>
          </div>
          {review.assessments.length > 0 && (
            <div className="grid gap-2">
              {review.assessments.map((a) => (
                <div key={a.dimension} className="rounded-md border p-2">
                  <div className="flex items-center justify-between font-medium">
                    <span>{tx(`marketing.cs.dim.${a.dimension}`)}</span>
                    <span className="text-xs text-muted-foreground">
                      {tx("marketing.cs.scoreAi", { n: a.score })}
                    </span>
                  </div>
                  <p className="text-xs text-muted-foreground">{a.explanation}</p>
                </div>
              ))}
            </div>
          )}
          {review.claims.length > 0 && (
            <div className="space-y-1">
              <h4 className="font-semibold">{tx("marketing.cs.claims")}</h4>
              {review.claims.map((c, i) => (
                <div key={i} className="flex flex-wrap items-start gap-2 rounded-md border p-2">
                  <Badge variant={STATUS[c.status]!.variant}>
                    {tx(`marketing.cs.cl.${c.status}`)}
                  </Badge>
                  <div className="min-w-0 flex-1">
                    <p>{c.claim}</p>
                    <p className="text-xs text-muted-foreground">
                      {c.factKeys.length
                        ? tx("marketing.cs.sourceFact", { k: c.factKeys.join(", ") })
                        : tx("marketing.cs.sourceMissing")}
                      {c.explanation ? ` — ${c.explanation}` : ""}
                    </p>
                  </div>
                </div>
              ))}
            </div>
          )}
          {review.suggestions.length > 0 && (
            <div className="space-y-2">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <h4 className="font-semibold">{tx("marketing.cs.suggestions")}</h4>
                {picked.length > 0 && (
                  <Button size="sm" onClick={() => apply(picked)}>
                    {tx("marketing.cs.applyN", { n: picked.length })}
                  </Button>
                )}
              </div>
              {SEV.map((sev) =>
                pending
                  .filter(({ s }) => s.severity === sev)
                  .map(({ s, i }) => (
                    <SuggestionCard
                      key={i}
                      s={s}
                      draft={draft}
                      picked={picked.includes(i)}
                      previewing={preview === i}
                      onPick={(v) => setPicked((p) => (v ? [...p, i] : p.filter((x) => x !== i)))}
                      onPreview={() => setPreview(preview === i ? null : i)}
                      onApply={() => apply([i])}
                      onReject={() => setDone((d) => ({ ...d, [i]: "rejected" }))}
                    />
                  )),
              )}
              {pending.length === 0 && (
                <p className="text-xs text-muted-foreground">{tx("marketing.cs.allHandled")}</p>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function SuggestionCard({
  s,
  draft,
  picked,
  previewing,
  onPick,
  onPreview,
  onApply,
  onReject,
}: {
  s: Suggestion;
  draft: string;
  picked: boolean;
  previewing: boolean;
  onPick: (v: boolean) => void;
  onPreview: () => void;
  onApply: () => void;
  onReject: () => void;
}) {
  const next = previewing ? applySuggestion(draft, s) : null;
  const { t: tx } = useI18n();
  const act = (a: string) =>
    `marketing.cs.act.${a}` in MESSAGES.en ? tx(`marketing.cs.act.${a}` as MessageKey) : a;
  return (
    <div className="space-y-1 rounded-md border p-2">
      <div className="flex items-start gap-2">
        <Checkbox
          checked={picked}
          onCheckedChange={(c) => onPick(!!c)}
          aria-label={tx("marketing.cs.selectSuggestion")}
        />
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap gap-1">
            <Badge
              variant={
                s.severity === "critical"
                  ? "destructive"
                  : s.severity === "important"
                    ? "secondary"
                    : "outline"
              }
            >
              {tx(`marketing.cs.sev.${s.severity}`)}
            </Badge>
            <Badge variant="outline">{act(s.action)}</Badge>
            <Badge variant="outline">{tx("marketing.cs.suggestion")}</Badge>
          </div>
          <p className="mt-1">{s.explanation}</p>
        </div>
      </div>
      {previewing &&
        (next === null ? (
          <p className="text-xs text-destructive">{tx("marketing.cs.noLongerMatch")}</p>
        ) : (
          <pre className="max-h-56 overflow-auto whitespace-pre-wrap rounded bg-muted/40 p-2 text-xs">
            {diffLines(draft, next)
              .filter((l) => l.kind !== "same")
              .map((l, k) => (
                <div
                  key={k}
                  className={
                    l.kind === "added" ? "bg-primary/15" : "bg-destructive/15 line-through"
                  }
                >
                  {l.kind === "added" ? "+ " : "− "}
                  {l.text}
                </div>
              ))}
          </pre>
        ))}
      <div className="flex flex-wrap gap-1">
        <Button size="sm" variant="ghost" onClick={onPreview}>
          <Eye className="mr-1 h-3 w-3" />
          {previewing ? tx("marketing.cs.hide") : tx("marketing.cs.preview")}
        </Button>
        <Button size="sm" variant="ghost" onClick={onApply}>
          <Check className="mr-1 h-3 w-3" />
          {tx("marketing.cs.apply")}
        </Button>
        <Button size="sm" variant="ghost" onClick={onReject}>
          <X className="mr-1 h-3 w-3" />
          {tx("marketing.cs.reject")}
        </Button>
      </div>
    </div>
  );
}
