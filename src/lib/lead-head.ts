import { readLocale } from "@/lib/i18n";
import { translate } from "@/lib/i18n/messages";
import { pageHead } from "@/lib/page-head";
export function leadHead(kind: "form" | "inbox") {
  const locale = readLocale();
  return pageHead(
    translate(locale, `lead.head.${kind}.t`),
    translate(locale, `lead.head.${kind}.d`),
  );
}
