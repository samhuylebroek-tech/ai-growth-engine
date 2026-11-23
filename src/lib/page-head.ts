import { readLocale } from "@/lib/i18n";
import { translate, type MessageKey } from "@/lib/i18n/messages";

export function pageHead(title: string, description: string) {
  const fullTitle = title === "AI Growth Engine" ? title : `${title} — AI Growth Engine`;
  return {
    meta: [
      { title: fullTitle },
      { name: "description", content: description },
      { property: "og:title", content: fullTitle },
      { property: "og:description", content: description },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
    ],
  };
}

/** Title and description in the interface language (same cookie on server and client; re-read on language change). */
export function localHead(key: string) {
  const l = readLocale();
  return pageHead(
    translate(l, `head.${key}.t` as MessageKey),
    translate(l, `head.${key}.d` as MessageKey),
  );
}
