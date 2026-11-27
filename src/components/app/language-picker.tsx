import { useI18n } from "@/lib/i18n";
import { LOCALES, LOCALE_NAME, isLocale } from "@/lib/i18n/messages";
import { cn } from "@/lib/utils";

/** Language choice for pages outside the app frame; stored in the same cookie the server reads. */
export function LanguagePicker({ className }: { className?: string }) {
  const { t, locale, setLocale } = useI18n();
  return (
    <select
      aria-label={t("pages.pub.language")}
      title={t("pages.pub.language")}
      value={locale}
      onChange={(e) => {
        if (isLocale(e.target.value)) setLocale(e.target.value);
      }}
      className={cn(
        "h-9 rounded-md border border-border bg-background px-2 text-xs text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
        className,
      )}
    >
      {LOCALES.map((l) => (
        <option key={l} value={l}>
          {LOCALE_NAME[l]}
        </option>
      ))}
    </select>
  );
}
