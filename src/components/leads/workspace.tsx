import { useState } from "react";
import { Link } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import type { SupabaseClient } from "@supabase/supabase-js";
import { ClipboardList, Copy, ExternalLink, Loader2, Plus } from "lucide-react";
import { toast } from "sonner";
import { z } from "zod";
import { supabase } from "@/integrations/supabase/client";
import { useOrg } from "@/lib/org-context";
import { hasRole } from "@/lib/permissions";
import { useI18n } from "@/lib/i18n";
import { LOCALES, LOCALE_NAME, type Locale } from "@/lib/i18n/messages";
import { collectPages } from "@/lib/pagination";
import { browserEnvironment } from "@/lib/environment";
import {
  leadFormConfigSchema,
  type LeadDatabase,
  type LeadFormRow,
  type LeadSubmissionRow,
  type LeadDecisionRow,
  type LeadFollowupRow,
} from "@/lib/lead-contract";
import { configureLeadForm, qualifyLead, prepareLeadFollowup } from "@/lib/lead.functions";
import { PageHeader, EmptyState } from "@/components/app/status";
import { Field } from "@/components/app/field";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { CrmGuidance } from "@/components/crm/guidance";
const client = supabase as unknown as SupabaseClient<LeadDatabase>;
export function LeadWorkspace() {
  const o = useOrg();
  const { t } = useI18n();
  if (o.loading) return <p role="status">{t("lead.loading")}</p>;
  if (!o.org || !o.workspace) return <p>{t("marketing.crm.chooseWs")}</p>;
  return (
    <Inbox
      key={`${o.org.id}/${o.workspace.id}`}
      orgId={o.org.id}
      workspaceId={o.workspace.id}
      canEdit={hasRole(o.workspaceRole, "member")}
      canConfigure={hasRole(o.workspaceRole, "admin")}
    />
  );
}
function Inbox({
  orgId,
  workspaceId,
  canEdit,
  canConfigure,
}: {
  orgId: string;
  workspaceId: string;
  canEdit: boolean;
  canConfigure: boolean;
}) {
  const { t, tag } = useI18n();
  const qc = useQueryClient();
  const [configure, setConfigure] = useState(false),
    [selected, setSelected] = useState<LeadFormRow | undefined>();
  const staging = browserEnvironment(import.meta.env["VITE_APP_ENVIRONMENT"]) === "staging";
  const key = ["lead-inbox", orgId, workspaceId];
  const result = useQuery({
    queryKey: key,
    enabled: staging,
    queryFn: async () => {
      const watermark = new Date().toISOString();
      const forms = await collectPages(async (cursor, size) => {
        let q = client
          .from("lead_forms")
          .select("*")
          .eq("org_id", orgId)
          .eq("workspace_id", workspaceId)
          .lte("created_at", watermark)
          .order("id")
          .limit(size);
        if (cursor) q = q.gt("id", cursor);
        return await q;
      });
      const submissions = await collectPages(async (cursor, size) => {
        let q = client
          .from("lead_submissions")
          .select("*")
          .eq("org_id", orgId)
          .eq("workspace_id", workspaceId)
          .lte("created_at", watermark)
          .order("id")
          .limit(size);
        if (cursor) q = q.gt("id", cursor);
        return await q;
      });
      const decisions = await collectPages(async (cursor, size) => {
        let q = client
          .from("lead_decisions")
          .select("*")
          .eq("org_id", orgId)
          .eq("workspace_id", workspaceId)
          .lte("created_at", watermark)
          .order("id")
          .limit(size);
        if (cursor) q = q.gt("id", cursor);
        return await q;
      });
      const followups = await collectPages(async (cursor, size) => {
        let q = client
          .from("lead_followups")
          .select("*")
          .eq("org_id", orgId)
          .eq("workspace_id", workspaceId)
          .lte("created_at", watermark)
          .order("id")
          .limit(size);
        if (cursor) q = q.gt("id", cursor);
        return await q;
      });
      return {
        forms,
        submissions: submissions.sort((a, b) => b.created_at.localeCompare(a.created_at)),
        decisions,
        followups,
      };
    },
  });
  async function refresh() {
    await Promise.all([
      qc.invalidateQueries({ queryKey: key }),
      qc.invalidateQueries({ queryKey: ["pipeline", orgId, workspaceId] }),
      qc.invalidateQueries({ queryKey: ["execution"] }),
    ]);
  }
  return (
    <div className="space-y-8">
      <PageHeader
        title={t("lead.title")}
        description={t("lead.intro")}
        actions={
          <Button variant="outline" asChild>
            <Link to="/app/pipeline">{t("lead.crm")}</Link>
          </Button>
        }
      />
      {!canEdit && <p className="text-sm text-muted-foreground">{t("lead.viewOnly")}</p>}
      {!staging || result.isError ? (
        <div role="alert" className="space-y-3 border-l-2 border-warning pl-4">
          <p>{t("lead.unavailable")}</p>
          {staging && (
            <Button variant="outline" onClick={() => void result.refetch()}>
              {t("lead.retry")}
            </Button>
          )}
        </div>
      ) : result.isPending ? (
        <p role="status">{t("lead.loading")}</p>
      ) : (
        result.data && (
          <>
            <section className="space-y-4 border-y border-border py-5">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <h2 className="text-lg font-semibold">{t("lead.forms")}</h2>
                {canConfigure && (
                  <Button
                    variant="outline"
                    onClick={() => {
                      setSelected(undefined);
                      setConfigure((v) => !v);
                    }}
                  >
                    <Plus />
                    {t("lead.configure")}
                  </Button>
                )}
              </div>
              {result.data.forms.map((f) => (
                <div key={f.id} className="flex flex-wrap items-center justify-between gap-3">
                  <div className="min-w-0">
                    <p className="break-words font-medium">{f.business_name}</p>
                    <p className="break-all text-xs text-muted-foreground">{f.form_key}</p>
                  </div>
                  <div className="flex flex-wrap gap-2">
                    <Badge variant="outline">
                      {f.active ? t("lead.active") : t("status.draft")}
                    </Badge>
                    {f.active && (
                      <>
                        <Button variant="outline" size="sm" asChild>
                          <Link
                            to="/enquire/$formKey"
                            params={{ formKey: f.form_key }}
                            target="_blank"
                          >
                            <ExternalLink />
                            {t("lead.open")}
                          </Link>
                        </Button>
                        <Button
                          variant="ghost"
                          size="icon"
                          title={t("lead.copy")}
                          aria-label={t("lead.copy")}
                          onClick={() =>
                            void navigator.clipboard
                              .writeText(`${location.origin}/enquire/${f.form_key}`)
                              .then(() => toast.success(t("lead.copied")))
                              .catch(() => toast.error(t("lead.unavailable")))
                          }
                        >
                          <Copy />
                        </Button>
                      </>
                    )}
                    {canConfigure && (
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => {
                          setSelected(f);
                          setConfigure(true);
                        }}
                      >
                        {t("lead.configure")}
                      </Button>
                    )}
                  </div>
                </div>
              ))}
              {configure && (
                <FormConfig
                  key={selected?.id ?? "new"}
                  existing={selected}
                  workspaceId={workspaceId}
                  onSaved={async () => {
                    setConfigure(false);
                    await refresh();
                  }}
                />
              )}
            </section>
            <section className="space-y-4">
              <h2 className="text-lg font-semibold">{t("lead.inbox")}</h2>
              {!result.data.submissions.length ? (
                <EmptyState
                  icon={<ClipboardList />}
                  title={t("lead.empty")}
                  text={t("lead.emptyText")}
                />
              ) : (
                result.data.submissions.map((s) => {
                  const decision = result.data.decisions
                    .filter((d) => d.submission_id === s.id)
                    .sort(
                      (a, b) =>
                        b.created_at.localeCompare(a.created_at) || b.id.localeCompare(a.id),
                    )[0];
                  const followup = result.data.followups.find((f) => f.submission_id === s.id);
                  return (
                    <LeadItem
                      key={s.id}
                      submission={s}
                      decision={decision}
                      followup={followup}
                      formKey={result.data.forms.find((f) => f.id === s.form_id)?.form_key ?? "—"}
                      canEdit={canEdit}
                      tag={tag}
                      refresh={refresh}
                    />
                  );
                })
              )}
            </section>
          </>
        )
      )}
    </div>
  );
}
function FormConfig({
  existing,
  workspaceId,
  onSaved,
}: {
  existing: LeadFormRow | undefined;
  workspaceId: string;
  onSaved: () => Promise<void>;
}) {
  const { t } = useI18n();
  const save = useServerFn(configureLeadForm);
  const [busy, setBusy] = useState(false);
  const [locale, setLocale] = useState<Locale>("en");
  const parsed = leadFormConfigSchema.safeParse(
    existing
      ? {
          key: existing.form_key,
          businessName: existing.business_name,
          privacyUrl: existing.privacy_url,
          copy: existing.copy,
          workspaceId,
          active: existing.active,
          dailyLimit: existing.daily_limit,
          hourlyLimit: existing.hourly_limit,
        }
      : null,
  );
  const [value, setValue] = useState(
    parsed.success
      ? parsed.data
      : {
          key: "",
          businessName: "",
          privacyUrl: "",
          copy: {
            en: { title: "", intro: "", consent: "" },
            nl: { title: "", intro: "", consent: "" },
            fr: { title: "", intro: "", consent: "" },
          },
          workspaceId,
          active: false,
          dailyLimit: 100,
          hourlyLimit: 30,
        },
  );
  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (busy) return;
    const input = leadFormConfigSchema.safeParse(value);
    if (!input.success) return void toast.error(t("lead.configInvalid"));
    setBusy(true);
    try {
      const r = await save({ data: input.data });
      if (!r.ok) toast.error(t("lead.unavailable"));
      else {
        toast.success(t("lead.saved"));
        await onSaved();
      }
    } catch {
      toast.error(t("lead.unavailable"));
    } finally {
      setBusy(false);
    }
  }
  return (
    <form onSubmit={submit} className="space-y-4 border-t border-border pt-5">
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label={t("lead.key")}>
          <Input
            required
            maxLength={64}
            readOnly={!!existing}
            value={value.key}
            onChange={(e) => setValue({ ...value, key: e.target.value })}
          />
        </Field>
        <Field label={t("lead.business")}>
          <Input
            required
            maxLength={160}
            value={value.businessName}
            onChange={(e) => setValue({ ...value, businessName: e.target.value })}
          />
        </Field>
      </div>
      <Field label={t("lead.privacyUrl")}>
        <Input
          required
          type="url"
          maxLength={1000}
          value={value.privacyUrl}
          onChange={(e) => setValue({ ...value, privacyUrl: e.target.value })}
        />
      </Field>
      <div className="flex gap-2">
        {LOCALES.map((l) => (
          <Button
            key={l}
            type="button"
            variant={locale === l ? "default" : "outline"}
            aria-pressed={locale === l}
            onClick={() => setLocale(l)}
          >
            {LOCALE_NAME[l]}
          </Button>
        ))}
      </div>
      <Field label={t("lead.formTitle")}>
        <Input
          maxLength={160}
          value={value.copy[locale].title}
          onChange={(e) =>
            setValue({
              ...value,
              copy: { ...value.copy, [locale]: { ...value.copy[locale], title: e.target.value } },
            })
          }
        />
      </Field>
      <Field label={t("lead.formIntro")}>
        <Textarea
          maxLength={600}
          value={value.copy[locale].intro}
          onChange={(e) =>
            setValue({
              ...value,
              copy: { ...value.copy, [locale]: { ...value.copy[locale], intro: e.target.value } },
            })
          }
        />
      </Field>
      <Field label={t("lead.consent")}>
        <Textarea
          maxLength={1000}
          value={value.copy[locale].consent}
          onChange={(e) =>
            setValue({
              ...value,
              copy: { ...value.copy, [locale]: { ...value.copy[locale], consent: e.target.value } },
            })
          }
        />
      </Field>
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label={t("lead.daily")}>
          <Input
            type="number"
            min={1}
            max={1000}
            value={value.dailyLimit}
            onChange={(e) => setValue({ ...value, dailyLimit: Number(e.target.value) })}
          />
        </Field>
        <Field label={t("lead.hourly")}>
          <Input
            type="number"
            min={1}
            max={100}
            value={value.hourlyLimit}
            onChange={(e) => setValue({ ...value, hourlyLimit: Number(e.target.value) })}
          />
        </Field>
      </div>
      <label className="flex items-center gap-3 text-sm">
        <input
          type="checkbox"
          checked={value.active}
          onChange={(e) => setValue({ ...value, active: e.target.checked })}
        />
        {t("lead.active")}
      </label>
      <Button disabled={busy} type="submit">
        {busy && <Loader2 className="animate-spin" />}
        {busy ? t("lead.saving") : t("lead.save")}
      </Button>
    </form>
  );
}
function LeadItem({
  submission: s,
  decision,
  followup,
  formKey,
  canEdit,
  tag,
  refresh,
}: {
  submission: LeadSubmissionRow;
  decision: LeadDecisionRow | undefined;
  followup: LeadFollowupRow | undefined;
  formKey: string;
  canEdit: boolean;
  tag: string;
  refresh: () => Promise<void>;
}) {
  const { t } = useI18n();
  const qualify = useServerFn(qualifyLead),
    prepare = useServerFn(prepareLeadFollowup);
  const [note, setNote] = useState(""),
    [title, setTitle] = useState(""),
    [due, setDue] = useState(""),
    [busy, setBusy] = useState(false);
  async function decide(value: "qualified" | "not_fit") {
    if (busy) return;
    if (!note.trim()) return void toast.error(t("lead.noteNeeded"));
    setBusy(true);
    try {
      const r = await qualify({ data: { submissionId: s.id, decision: value, note } });
      if (!r.ok) toast.error(t("lead.unavailable"));
      else {
        setNote("");
        await refresh();
      }
    } catch {
      toast.error(t("lead.unavailable"));
    } finally {
      setBusy(false);
    }
  }
  async function follow() {
    if (busy) return;
    const input = z
      .object({
        submissionId: z.guid(),
        title: z.string().trim().min(1).max(200),
        due: z.iso.date().nullable(),
      })
      .safeParse({ submissionId: s.id, title, due: due || null });
    if (!input.success) return void toast.error(t("lead.invalid"));
    setBusy(true);
    try {
      const r = await prepare({ data: input.data });
      if (!r.ok) toast.error(t("lead.unavailable"));
      else await refresh();
    } catch {
      toast.error(t("lead.unavailable"));
    } finally {
      setBusy(false);
    }
  }
  return (
    <article className="space-y-4 border-b border-border pb-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <h3 className="break-words font-semibold">{s.name}</h3>
          <p className="break-all text-sm text-muted-foreground">{s.email}</p>
          <p className="mt-1 text-xs text-muted-foreground">
            {t("lead.received")}: {new Date(s.created_at).toLocaleString(tag)}
          </p>
        </div>
        <Badge variant="outline">
          {decision ? t(`lead.${decision.decision}`) : t("lead.pending")}
        </Badge>
      </div>
      <div className="flex flex-wrap items-center gap-2">
        <CrmGuidance kind="crm_contacts" id={s.contact_id} />
        {followup && (
          <Button variant="outline" asChild>
            <Link to="/app/tasks" search={{ item: followup.task_id }}>
              {t("lead.task")}
            </Link>
          </Button>
        )}
      </div>
      <details className="text-sm">
        <summary className="min-h-11 cursor-pointer py-3 font-medium">{t("lead.details")}</summary>
        <div className="space-y-3 border-l border-border pl-4">
          <p className="whitespace-pre-wrap break-words">{s.message || "—"}</p>
          <p>
            {t("lead.source")}: {formKey}
          </p>
          <p>{s.phone}</p>
          <p className="whitespace-pre-wrap">{s.consent_text}</p>
          <a
            className="inline-flex min-h-11 items-center text-primary underline"
            href={s.privacy_url}
            target="_blank"
            rel="noreferrer"
          >
            {t("lead.privacy")}
          </a>
          <p className="break-words text-xs">
            {t("lead.attribution")}: {JSON.stringify(s.attribution)}
          </p>
          {decision && <p className="whitespace-pre-wrap">{decision.note}</p>}
        </div>
      </details>
      {canEdit && (
        <div className="space-y-3">
          <Field label={t("lead.note")}>
            <Textarea
              maxLength={1000}
              rows={2}
              value={note}
              onChange={(e) => setNote(e.target.value)}
            />
          </Field>
          <div className="flex flex-wrap gap-2">
            <Button
              variant="outline"
              disabled={busy || !note.trim()}
              onClick={() => void decide("qualified")}
            >
              {t("lead.qualify")}
            </Button>
            <Button
              variant="ghost"
              disabled={busy || !note.trim()}
              onClick={() => void decide("not_fit")}
            >
              {t("lead.reject")}
            </Button>
          </div>
          {decision?.decision === "qualified" && !followup && (
            <div className="space-y-3 border-l-2 border-primary pl-4">
              <Field label={t("lead.taskTitle")}>
                <Input maxLength={200} value={title} onChange={(e) => setTitle(e.target.value)} />
              </Field>
              <Field label={t("lead.due")}>
                <Input type="date" value={due} onChange={(e) => setDue(e.target.value)} />
              </Field>
              <p className="text-xs text-muted-foreground">{t("lead.draftOnly")}</p>
              <Button disabled={busy || !title.trim()} onClick={() => void follow()}>
                {t("lead.followup")}
              </Button>
            </div>
          )}
        </div>
      )}
    </article>
  );
}
