import { readLocale } from "@/lib/i18n";
import { translate, type MessageKey } from "@/lib/i18n/messages";
import { limitAware } from "@/lib/rate-limit";

/** A server refusal in the interface language (rate limits and known refusals); other messages pass through unchanged. */
export function serverErrorText(message: string): string {
  const locale = readLocale();
  return limitAware(message, (key, vars) => translate(locale, key as MessageKey, vars));
}
