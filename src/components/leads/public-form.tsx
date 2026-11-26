import { useEffect, useRef, useState, type FormEvent } from "react";
import { useServerFn } from "@tanstack/react-start";
import { useRouter } from "@tanstack/react-router";
import { CheckCircle2, Loader2, Send } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Field } from "@/components/app/field";
import { useI18n } from "@/lib/i18n";
import { LOCALES, LOCALE_NAME, isLocale } from "@/lib/i18n/messages";
import { leadSubmitSchema, type PublicLeadForm, type LeadError } from "@/lib/lead-contract";
import { openLeadSession, submitPublicLead } from "@/lib/lead.functions";

export function PublicForm({ form }: { form: PublicLeadForm | null }) {
  const { t, locale, setLocale } = useI18n();
  const router = useRouter();
  return (
    <main className="mx-auto min-h-dvh w-full max-w-xl px-5 py-10 sm:py-16">
      <div className="mb-10 flex items-start justify-between gap-4 border-b border-border pb-5">
        <p className="min-w-0 break-words text-lg font-semibold">
          {form?.businessName ?? "AI Growth Engine"}
        </p>
        <select
          className="h-10 shrink-0 rounded-md border border-input bg-background px-2 text-sm"
          aria-label={t("lead.language")}
          value={locale}
          onChange={(e) => {
            if (isLocale(e.target.value)) setLocale(e.target.value);
          }}
        >
          {LOCALES.map((l) => (
            <option key={l} value={l}>
              {LOCALE_NAME[l]}
            </option>
          ))}
        </select>
      </div>
      {form ? (
        <Enquiry key={form.key} form={form} />
      ) : (
        <section className="space-y-5">
          <h1 className="text-2xl font-semibold">{t("lead.head.form.t")}</h1>
          <p role="alert" className="text-sm text-muted-foreground">
            {t("lead.unavailable")}
          </p>
          <Button variant="outline" onClick={() => void router.invalidate()}>
            {t("lead.retry")}
          </Button>
        </section>
      )}
    </main>
  );
}
function Enquiry({ form }: { form: PublicLeadForm }) {
  const { t, locale } = useI18n();
  const open = useServerFn(openLeadSession),
    send = useServerFn(submitPublicLead);
  const copy = form.copy[locale];
  const [session, setSession] = useState<string | null>(null);
  const [ready, setReady] = useState(false);
  const [error, setError] = useState<LeadError | null>(null);
  const [busy, setBusy] = useState(false),
    [success, setSuccess] = useState(false);
  const [values, setValues] = useState({
    name: "",
    email: "",
    phone: "",
    message: "",
    website: "",
    consent: false,
  });
  const [attribution, setAttribution] = useState({ source: "", medium: "", campaign: "" });
  const started = useRef(false);
  const opening = useRef(false);
  const request = useRef<{ fingerprint: string; id: string } | null>(null);
  async function startSession() {
    if (opening.current || busy) return;
    opening.current = true;
    setSession(null);
    setReady(false);
    setError(null);
    try {
      const result = await open({ data: { formKey: form.key } });
      if (result.ok) setSession(result.sessionId);
      else setError(result.error);
    } catch {
      setError("unavailable");
    } finally {
      opening.current = false;
    }
  }
  useEffect(() => {
    if (started.current) return;
    started.current = true;
    const params = new URLSearchParams(location.search);
    setAttribution({
      source: (params.get("utm_source") ?? "").slice(0, 120),
      medium: (params.get("utm_medium") ?? "").slice(0, 120),
      campaign: (params.get("utm_campaign") ?? "").slice(0, 120),
    });
    void open({ data: { formKey: form.key } })
      .then((r) => {
        if (r.ok) setSession(r.sessionId);
        else setError(r.error);
      })
      .catch(() => setError("unavailable"));
  }, [form.key, open]);
  useEffect(() => {
    if (!session) return;
    const timer = setTimeout(() => setReady(true), 3000);
    return () => clearTimeout(timer);
  }, [session]);
  async function submit(e: FormEvent) {
    e.preventDefault();
    if (busy || !session) return;
    const input = {
      ...values,
      formKey: form.key,
      sessionId: session,
      locale,
      consentText: copy.consent,
      privacyUrl: form.privacyUrl,
      attribution,
    };
    const fingerprint = JSON.stringify(input);
    const id =
      request.current?.fingerprint === fingerprint ? request.current.id : crypto.randomUUID();
    const parsed = leadSubmitSchema.safeParse({ ...input, requestId: id });
    if (!parsed.success) {
      setError("invalid");
      return;
    }
    request.current = { fingerprint, id };
    setBusy(true);
    setError(null);
    try {
      const result = await send({ data: parsed.data });
      if (result.ok) {
        setSuccess(true);
        setValues({ name: "", email: "", phone: "", message: "", website: "", consent: false });
      } else setError(result.error);
    } catch {
      setError("unavailable");
    } finally {
      setBusy(false);
    }
  }
  if (success)
    return (
      <section role="status" className="space-y-4 py-8">
        <CheckCircle2 className="h-10 w-10 text-success" />
        <h1 className="text-2xl font-semibold">{t("lead.success")}</h1>
      </section>
    );
  return (
    <section>
      <h1 className="break-words text-2xl font-semibold">{copy.title}</h1>
      <p className="mt-3 whitespace-pre-wrap text-sm text-muted-foreground">{copy.intro}</p>
      <form className="mt-8 space-y-5" onSubmit={submit}>
        <Field label={t("lead.name")}>
          <Input
            autoComplete="name"
            required
            maxLength={120}
            value={values.name}
            onChange={(e) => setValues({ ...values, name: e.target.value })}
          />
        </Field>
        <Field label={t("lead.email")}>
          <Input
            autoComplete="email"
            type="email"
            required
            maxLength={255}
            value={values.email}
            onChange={(e) => setValues({ ...values, email: e.target.value })}
          />
        </Field>
        <Field label={t("lead.phone")}>
          <Input
            autoComplete="tel"
            type="tel"
            maxLength={40}
            value={values.phone}
            onChange={(e) => setValues({ ...values, phone: e.target.value })}
          />
        </Field>
        <Field label={t("lead.message")}>
          <Textarea
            rows={4}
            maxLength={2000}
            value={values.message}
            onChange={(e) => setValues({ ...values, message: e.target.value })}
          />
        </Field>
        <div className="hidden" aria-hidden="true">
          <label>
            Website
            <input
              tabIndex={-1}
              autoComplete="off"
              value={values.website}
              onChange={(e) => setValues({ ...values, website: e.target.value })}
            />
          </label>
        </div>
        <label className="flex items-start gap-3 text-sm leading-relaxed">
          <input
            className="mt-1 h-5 w-5 shrink-0 accent-primary"
            type="checkbox"
            required
            checked={values.consent}
            onChange={(e) => setValues({ ...values, consent: e.target.checked })}
          />
          <span>{copy.consent}</span>
        </label>
        <a
          href={form.privacyUrl}
          target="_blank"
          rel="noreferrer"
          className="inline-flex min-h-11 items-center text-sm text-primary underline underline-offset-4"
        >
          {t("lead.privacy")}
        </a>
        {error && (
          <p role="alert" className="text-sm text-destructive">
            {t(error === "unavailable" && session ? "lead.unconfirmed" : `lead.${error}`)}
          </p>
        )}
        {error && (!session || error === "expired") && (
          <Button
            variant="outline"
            type="button"
            className="w-full"
            onClick={() => void startSession()}
          >
            {t("lead.retry")}
          </Button>
        )}
        <Button className="w-full" type="submit" disabled={busy || !session || !ready}>
          {busy || (!session && !error) ? <Loader2 className="animate-spin" /> : <Send />}
          {busy ? t("lead.sending") : t("lead.send")}
        </Button>
      </form>
    </section>
  );
}
