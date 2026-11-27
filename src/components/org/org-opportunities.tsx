import { useState } from "react";
import { evidenceQuality, fromClassified } from "@/lib/evidence";
import { QualityBadge } from "@/components/bi/evidence";
import { useNavigate } from "@tanstack/react-router";
import { useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { useI18n } from "@/lib/i18n";
import { useOrg } from "@/lib/org-context";
import { can } from "@/lib/permissions";
import { growthDb, type OrgOpportunityRow } from "@/lib/pending-schema";
import type { OppDraft } from "@/lib/org/opportunities";
import { Section, Badge, sel } from "@/components/bi/parts";
import { Panel, StatusChip } from "@/components/app/status";
import { Button } from "@/components/ui/button";
import {
  tk,
  useRefNamer,
  useNames,
  useKnown,
  Empty,
  type OrgModel,
} from "@/components/org/org-model";
import { EvidenceLabel, EvidenceScopeProvider } from "@/components/ai/evidence";
import { orgClaim } from "@/lib/org/claims";
import { INITIATIVE_DRAFT_KEY, type InitiativeDraft } from "@/components/org/org-strategy";

type Ev = { text: string; class: string };
const evidenceOf = (x: unknown): Ev[] =>
  Array.isArray(x)
    ? x.filter((e): e is Ev => !!e && typeof e === "object" && typeof (e as Ev).text === "string")
    : [];

export function OpportunitiesTab({ m }: { m: OrgModel }) {
  const { t } = useI18n();
  const o = useOrg();
  const refNamer = useRefNamer();
  // Opportunities proposed by the Organization Growth Officer use its B1/B2 references; names come from that strategy.
  const nameFrom =
    (body: unknown, ids: readonly string[]) =>
    (x: OrgOpportunityRow): OrgOpportunityRow => {
      const { named } = refNamer(body, ids);
      return {
        ...x,
        title: named(x.title),
        evidence: named(x.evidence),
        expected_impact: named(x.expected_impact),
        estimated_cost: named(x.estimated_cost),
        dependencies: named(x.dependencies),
        risks: named(x.risks),
        next_action: named(x.next_action),
      };
    };
  const [filter, setFilter] = useState<"open" | "all">("open");
  if (!m.model) return null;
  const tracked = (m.intel.data?.opportunities ?? []).filter(
    (x) => filter === "all" || !["dismissed", "converted"].includes(x.status),
  );
  return (
    <>
      <p className="mb-4 max-w-3xl text-xs text-muted-foreground">{t("ogo.opp.privacy")}</p>
      <Section title={t("ogo.opp.detected")} intro={t("ogo.opp.detectedIntro")}>
        {m.model.iq.drafts.length ? (
          <ul className="grid gap-3 lg:grid-cols-2">
            {m.model.iq.drafts.map((d) => (
              <DraftCard
                key={d.ruleKey}
                d={d}
                canTrack={can(o.role, "org.coordinate") && !!m.intel.data?.installed}
              />
            ))}
          </ul>
        ) : (
          <Empty>
            {m.businesses.length < 2 ? t("ogo.opp.needTwo") : t("ogo.opp.noneDetected")}
          </Empty>
        )}
      </Section>
      <Section
        title={t("ogo.opp.tracked")}
        intro={t("ogo.opp.trackedIntro")}
        action={
          <div className="w-48">
            <select
              aria-label={t("ogo.filter")}
              className={sel}
              value={filter}
              onChange={(e) => setFilter(e.target.value as "open" | "all")}
            >
              <option value="open">{t("ogo.filter.open")}</option>
              <option value="all">{t("ogo.filter.all")}</option>
            </select>
          </div>
        }
      >
        {m.intel.data && !m.intel.data.installed ? (
          <Empty>{t("ogo.off")}</Empty>
        ) : tracked.length ? (
          <ul className="grid gap-3 lg:grid-cols-2">
            {tracked.map((x) => {
              const st = x.strategy_id
                ? m.intel.data?.strategies.find((y) => y.id === x.strategy_id)
                : undefined;
              return <TrackedCard key={x.id} x={st ? nameFrom(st.body, st.business_ids)(x) : x} />;
            })}
          </ul>
        ) : (
          <Empty>{t("ogo.opp.noneTracked")}</Empty>
        )}
      </Section>
    </>
  );
}

/** Localized texts of a rule-detected opportunity; the same texts are stored when it is tracked. */
function useDraftText() {
  const { t } = useI18n();
  const name = useNames();
  const known = useKnown();
  return (d: OppDraft) => {
    const [a, b] = d.businesses.map(name);
    const subject =
      d.kind === "specialist_reuse"
        ? known(`run.sp.${d.subject}`, d.subject)
        : d.kind === "strategy_reuse"
          ? known(`goals.obj.${d.subject}`, d.subject)
          : d.subject;
    return {
      title: t(tk(`ogo.opp.title.${d.kind}`), { a: a ?? "", b: b ?? "", subject }),
      evidence: d.evidence.map((e) => ({ text: t(tk(`ogo.${e.code}`), e.params), class: e.class })),
      impact: t(tk(`ogo.impact.${d.impact}`)),
      cost: t(tk(`ogo.cost.${d.cost}`)),
      dependencies: d.dependencies.map((x) => t(tk(`ogo.${x}`))).join(" · "),
      risks: d.risks.map((x) => t(tk(`ogo.${x}`))).join(" · "),
      next: t(tk(`ogo.${d.next}`)),
    };
  };
}

function DraftCard({ d, canTrack }: { d: OppDraft; canTrack: boolean }) {
  const o = useOrg();
  const { t } = useI18n();
  const qc = useQueryClient();
  const text = useDraftText()(d);
  const name = useNames();
  const [busy, setBusy] = useState(false);
  async function track() {
    if (busy || !o.org) return;
    setBusy(true);
    try {
      const r = await growthDb.rpc("record_org_opportunity", {
        _org: o.org.id,
        _p: {
          rule_key: d.ruleKey,
          kind: d.kind,
          title: text.title.slice(0, 200),
          business_ids: d.businesses,
          evidence: text.evidence.map((e) => ({ text: e.text.slice(0, 500), class: e.class })),
          expected_impact: text.impact,
          estimated_cost: text.cost,
          dependencies: text.dependencies,
          risks: text.risks,
          confidence: d.confidence,
          next_action: text.next,
        },
      });
      if (r.error) {
        toast.error(r.error.message);
        return;
      }
      toast.success(t("ogo.opp.trackedToast"));
      await qc.invalidateQueries({ queryKey: ["org-intel", o.org.id] });
    } finally {
      setBusy(false);
    }
  }
  return (
    <li>
      <Panel className="h-full">
        <div className="flex flex-wrap items-center gap-2">
          <Badge kind="planned">{t(tk(`ogo.kind.${d.kind}`))}</Badge>
          <Badge kind={d.confidence}>{t(tk(`ogo.conf.${d.confidence}`))}</Badge>
          <span className="text-xs text-muted-foreground">{t("ogo.opp.hypothesis")}</span>
        </div>
        <p className="mt-2 text-sm font-medium">{text.title}</p>
        <p className="mt-0.5 text-xs text-muted-foreground">{d.businesses.map(name).join(" · ")}</p>
        <Details
          origin="rule"
          evidence={text.evidence}
          impact={text.impact}
          cost={text.cost}
          deps={text.dependencies}
          risks={text.risks}
          next={text.next}
        />
        {canTrack && (
          <Button size="sm" variant="outline" className="mt-3" onClick={track} disabled={busy}>
            {t("ogo.opp.track")}
          </Button>
        )}
      </Panel>
    </li>
  );
}

function Details({
  origin,
  evidence,
  impact,
  cost,
  deps,
  risks,
  next,
}: {
  origin: "ai" | "rule";
  evidence: Ev[];
  impact: string;
  cost: string;
  deps: string;
  risks: string;
  next: string;
}) {
  const { t } = useI18n();
  // Rule evidence is read from records; AI "verified" claims count as unverified assumptions (proposal 0073).
  const quality = evidenceQuality(evidence.map((e) => fromClassified(e.class, origin)));
  const o = useOrg();
  // Cited business records are looked up across every business of the organization the viewer may open.
  const body = (
    <dl className="mt-3 space-y-1.5 text-xs">
      <div>
        <QualityBadge q={quality} showReasons />
      </div>
      <div>
        <dt className="font-medium">{t("ogo.opp.evidence")}</dt>
        <dd>
          <ul className="mt-0.5 space-y-0.5">
            {evidence.map((e, i) => {
              const c = orgClaim(e.class, origin, e.text);
              return (
                <li key={i}>
                  <EvidenceLabel kind={c.kind} downgraded={c.downgraded} text={e.text} />
                  <span>{e.text}</span>
                </li>
              );
            })}
          </ul>
        </dd>
      </div>
      {impact && (
        <div>
          <dt className="inline font-medium">{t("ogo.opp.impact")}: </dt>
          <dd className="inline">{impact}</dd>
        </div>
      )}
      {cost && (
        <div>
          <dt className="inline font-medium">{t("ogo.opp.cost")}: </dt>
          <dd className="inline">{cost}</dd>
        </div>
      )}
      {deps && (
        <div>
          <dt className="inline font-medium">{t("ogo.opp.deps")}: </dt>
          <dd className="inline">{deps}</dd>
        </div>
      )}
      {risks && (
        <div>
          <dt className="inline font-medium">{t("ogo.opp.risks")}: </dt>
          <dd className="inline">{risks}</dd>
        </div>
      )}
      {next && (
        <div>
          <dt className="inline font-medium">{t("ogo.opp.next")}: </dt>
          <dd className="inline">{next}</dd>
        </div>
      )}
    </dl>
  );
  return o.org ? (
    <EvidenceScopeProvider value={{ orgId: o.org.id, workspaceId: null }}>
      {body}
    </EvidenceScopeProvider>
  ) : (
    body
  );
}

const MOVES: Record<string, ("validating" | "validated" | "dismissed" | "hypothesis")[]> = {
  hypothesis: ["validating", "validated", "dismissed"],
  validating: ["validated", "dismissed", "hypothesis"],
  validated: ["dismissed"],
  dismissed: [],
  converted: [],
};
function TrackedCard({ x }: { x: OrgOpportunityRow }) {
  const o = useOrg();
  const { t } = useI18n();
  const qc = useQueryClient();
  const name = useNames();
  const navigate = useNavigate();
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState("");
  const edit = can(o.role, "org.coordinate");
  async function move(s: string) {
    if (busy) return;
    setBusy(true);
    try {
      const r = await growthDb.rpc("set_org_opportunity_status", {
        _id: x.id,
        _status: s,
        _note: note,
      });
      if (r.error) {
        toast.error(r.error.message);
        return;
      }
      setNote("");
      await qc.invalidateQueries({ queryKey: ["org-intel"] });
      await qc.invalidateQueries({ queryKey: ["org-decisions"] });
    } finally {
      setBusy(false);
    }
  }
  function propose() {
    if (!o.org) return;
    const draft: InitiativeDraft = {
      title: x.title,
      shared: x.next_action || x.expected_impact,
      businesses: x.business_ids,
      objectives: {},
      opportunityId: x.id,
      ...(x.strategy_id ? { strategyId: x.strategy_id } : {}),
    };
    sessionStorage.setItem(INITIATIVE_DRAFT_KEY(o.org.id), JSON.stringify(draft));
    void navigate({ to: "/app/organization", search: { tab: "initiatives" } });
  }
  return (
    <li>
      <Panel className="h-full">
        <div className="flex flex-wrap items-center gap-2">
          <Badge kind="planned">{t(tk(`ogo.kind.${x.kind}`))}</Badge>
          <Badge kind={x.confidence}>{t(tk(`ogo.conf.${x.confidence}`))}</Badge>
          <StatusChip status={x.status}>{t(tk(`ogo.oppStatus.${x.status}`))}</StatusChip>
          <span className="text-2xs text-muted-foreground">{t(tk(`ogo.origin.${x.origin}`))}</span>
        </div>
        <p className="mt-2 text-sm font-medium">{x.title}</p>
        <p className="mt-0.5 text-xs text-muted-foreground">
          {x.business_ids.map(name).join(" · ")}
        </p>
        <Details
          origin={x.origin === "ai" ? "ai" : "rule"}
          evidence={evidenceOf(x.evidence)}
          impact={x.expected_impact}
          cost={x.estimated_cost}
          deps={x.dependencies}
          risks={x.risks}
          next={x.next_action}
        />
        {x.decision_note && (
          <p className="mt-2 text-xs text-muted-foreground">
            {t("ogo.lastNote", { note: x.decision_note })}
          </p>
        )}
        {edit && MOVES[x.status]!.length > 0 && (
          <div className="mt-3 flex flex-wrap items-center gap-2 border-t border-border pt-3">
            <input
              aria-label={t("ogo.note")}
              className={`${sel} w-full sm:w-48`}
              maxLength={1000}
              placeholder={t("ogo.notePh")}
              value={note}
              onChange={(e) => setNote(e.target.value)}
            />
            {MOVES[x.status]!.map((s) => (
              <Button
                key={s}
                size="sm"
                variant={s === "dismissed" ? "ghost" : "outline"}
                disabled={busy}
                onClick={() => move(s)}
              >
                {t(tk(`ogo.oppMove.${s}`))}
              </Button>
            ))}
            {x.status !== "dismissed" &&
              x.business_ids.every((id) => o.workspaces.some((w) => w.id === id)) && (
                <Button size="sm" disabled={busy} onClick={propose}>
                  {t("ogo.opp.propose")}
                </Button>
              )}
          </div>
        )}
      </Panel>
    </li>
  );
}
