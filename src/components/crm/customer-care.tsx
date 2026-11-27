import { useRef, useState } from "react";
import { Link } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { ClipboardPlus, HeartHandshake } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { Field } from "@/components/app/field";
import { CrmGuidance } from "@/components/crm/guidance";
import { useI18n } from "@/lib/i18n";
import { supabase } from "@/integrations/supabase/client";
import { collectPages } from "@/lib/pagination";
import { localDay } from "@/lib/execution";
import { customerPurpose, customerTaskState, type CustomerWorkInput } from "@/lib/customer-work";
import { prepareCustomerWork } from "@/lib/customer-work.functions";

type Sale = {
  id: string;
  title: string;
  stage: string;
  contact_id: string | null;
  expected_close: string | null;
};
export function CustomerCare({
  orgId,
  wsId,
  canEdit,
  deals,
  contacts,
  contactScope,
}: {
  orgId: string;
  wsId: string;
  canEdit: boolean;
  deals: readonly Sale[];
  contacts: readonly { id: string; name: string }[];
  contactScope: string | undefined;
}) {
  const { t, tag } = useI18n();
  const qc = useQueryClient();
  const prepare = useServerFn(prepareCustomerWork);
  const [category, setCategory] = useState("retention");
  const [selected, setSelected] = useState<Sale | null>(null);
  const [title, setTitle] = useState("");
  const [body, setBody] = useState("");
  const [due, setDue] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(false);
  const [saved, setSaved] = useState<string | null>(null);
  const request = useRef<CustomerWorkInput | null>(null);
  const lock = useRef(false);
  const tasks = useQuery({
    queryKey: ["customer-work", orgId, wsId],
    queryFn: async () => {
      const watermark = new Date().toISOString();
      return collectPages(async (cursor, size) => {
        let q = supabase
          .from("tasks")
          .select("id,title,status,due_date,labels")
          .eq("org_id", orgId)
          .eq("workspace_id", wsId)
          .contains("labels", ["customer-work"])
          .lte("created_at", watermark)
          .order("id")
          .limit(size);
        if (cursor) q = q.gt("id", cursor);
        return await q;
      });
    },
  });
  const today = localDay();
  const sales = deals
    .filter(
      (d) =>
        (!contactScope || d.contact_id === contactScope) && customerPurpose(d.stage) === category,
    )
    .sort(
      (a, b) =>
        (a.expected_close ?? "9999").localeCompare(b.expected_close ?? "9999") ||
        a.title.localeCompare(b.title),
    );
  async function save() {
    if (!selected || !canEdit || lock.current || !title.trim()) return;
    lock.current = true;
    setBusy(true);
    setError(false);
    // Freeze the first submitted draft. An uncertain acknowledgement retries exactly this request.
    request.current ??= {
      orgId,
      workspaceId: wsId,
      dealId: selected.id,
      requestId: crypto.randomUUID(),
      purpose: customerPurpose(selected.stage),
      title,
      description: body,
      due,
    };
    try {
      const result = await prepare({ data: request.current });
      setSaved(result.id);
      setSelected(null);
      request.current = null;
      await Promise.all([
        qc.invalidateQueries({ queryKey: ["customer-work", orgId, wsId] }),
        qc.invalidateQueries({ queryKey: ["execution"] }),
      ]);
    } catch {
      setError(true);
    } finally {
      lock.current = false;
      setBusy(false);
    }
  }
  return (
    <section className="space-y-5">
      <div className="flex flex-wrap items-center gap-2">
        <HeartHandshake className="size-5 text-primary" />
        {(["retention", "reactivation", "followup"] as const).map((kind) => (
          <Button
            key={kind}
            size="sm"
            variant={category === kind ? "default" : "outline"}
            aria-pressed={category === kind}
            onClick={() => {
              setCategory(kind);
            }}
          >
            {t(`marketing.care.${kind}`)}
          </Button>
        ))}
      </div>
      <p className="text-sm text-muted-foreground">{t("marketing.care.evidence")}</p>
      {saved && (
        <div
          role="status"
          className="flex flex-wrap items-center gap-3 border-l-2 border-primary pl-4"
        >
          <span className="text-sm">{t("marketing.care.saved")}</span>
          <Button asChild variant="outline" size="sm">
            <Link to="/app/tasks" search={{ item: saved }}>
              {t("lead.task")}
            </Link>
          </Button>
        </div>
      )}
      {tasks.isError ? (
        <div role="alert" className="space-y-2">
          <p className="text-destructive">{t("marketing.care.unavailable")}</p>
          <Button variant="outline" onClick={() => void tasks.refetch()}>
            {t("lead.retry")}
          </Button>
        </div>
      ) : !tasks.data ? (
        <p role="status">{t("marketing.crm.loading")}</p>
      ) : (
        <>
          {!sales.length && (
            <p className="text-sm text-muted-foreground">{t("marketing.care.empty")}</p>
          )}
          <ul className="divide-y divide-border">
            {sales.map((sale) => {
              const work = tasks.data.filter((task) => task.labels.includes(`crm-deal:${sale.id}`));
              const open = work.some((task) => !["done", "cancelled"].includes(task.status));
              return (
                <li key={sale.id} className="space-y-3 py-4">
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <div className="min-w-0">
                      <h2 className="break-words text-sm font-semibold">{sale.title}</h2>
                      <p className="text-xs text-muted-foreground">
                        {contacts.find((c) => c.id === sale.contact_id)?.name ??
                          t("marketing.crm.noContact")}
                      </p>
                      {sale.expected_close && (
                        <p className="text-xs text-muted-foreground">
                          {t("marketing.crm.expectedClose")}:{" "}
                          {new Date(`${sale.expected_close}T12:00:00`).toLocaleDateString(tag)}
                        </p>
                      )}
                    </div>
                    <div className="flex flex-wrap gap-2">
                      <CrmGuidance kind="crm_deals" id={sale.id} stage={sale.stage} />
                      {canEdit && (
                        <Button
                          size="sm"
                          variant="outline"
                          disabled={open || busy || selected !== null}
                          title={open ? t("marketing.care.openFirst") : undefined}
                          onClick={() => {
                            setSelected(sale);
                            setTitle(
                              t(`marketing.care.${customerPurpose(sale.stage)}`) +
                                `: ${sale.title}`,
                            );
                            setBody("");
                            setDue("");
                            setError(false);
                          }}
                        >
                          <ClipboardPlus />
                          {t("marketing.care.prepare")}
                        </Button>
                      )}
                    </div>
                  </div>
                  {work.length > 0 && (
                    <ul className="space-y-2">
                      {work.map((task) => (
                        <li key={task.id} className="flex flex-wrap items-center gap-3 text-sm">
                          <Link
                            to="/app/tasks"
                            search={{ item: task.id }}
                            className="inline-flex min-h-9 items-center text-primary underline underline-offset-4"
                          >
                            {task.title}
                          </Link>
                          <Badge variant="outline">
                            {t(
                              `marketing.care.state.${customerTaskState(task.status, task.due_date, today)}`,
                            )}
                          </Badge>
                          {task.due_date && (
                            <span className="text-xs text-muted-foreground">{task.due_date}</span>
                          )}
                        </li>
                      ))}
                    </ul>
                  )}
                </li>
              );
            })}
          </ul>
        </>
      )}
      {selected && (
        <form
          className="space-y-4 border-y border-border py-5"
          onSubmit={(e) => {
            e.preventDefault();
            void save();
          }}
        >
          <h2 className="break-words text-sm font-semibold">{selected.title}</h2>
          <Field label={t("lead.taskTitle")}>
            <Input
              required
              maxLength={200}
              value={title}
              disabled={busy || error}
              onChange={(e) => setTitle(e.target.value)}
            />
          </Field>
          <Field label={t("marketing.care.brief")}>
            <Textarea
              maxLength={8000}
              value={body}
              disabled={busy || error}
              onChange={(e) => setBody(e.target.value)}
            />
          </Field>
          <Field label={t("lead.due")}>
            <Input
              type="date"
              value={due}
              disabled={busy || error}
              onChange={(e) => setDue(e.target.value)}
            />
          </Field>
          <p className="text-xs text-muted-foreground">{t("lead.draftOnly")}</p>
          {error && (
            <p role="alert" className="text-destructive">
              {t("marketing.care.unconfirmed")}
            </p>
          )}
          <div className="flex flex-wrap gap-2">
            <Button type="submit" disabled={busy || !title.trim()}>
              {busy ? t("lead.saving") : error ? t("lead.retry") : t("marketing.care.prepare")}
            </Button>
            {!error && (
              <Button
                type="button"
                variant="ghost"
                disabled={busy}
                onClick={() => setSelected(null)}
              >
                {t("marketing.cs.cancel")}
              </Button>
            )}
          </div>
        </form>
      )}
    </section>
  );
}
