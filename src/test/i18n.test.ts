import { describe, expect, it } from "vitest";
import { LOCALES, MESSAGES, resolveLocale, translate } from "@/lib/i18n/messages";
import { NAVIGATION } from "@/lib/navigation";

describe("interface languages", () => {
  it("defines every English key in Dutch and French, none left empty", () => {
    const keys = Object.keys(MESSAGES.en).sort();
    for (const l of LOCALES) {
      expect(Object.keys(MESSAGES[l]).sort()).toEqual(keys);
      expect(Object.values(MESSAGES[l]).every((v) => v.trim().length > 0)).toBe(true);
    }
  });
  it("translates every navigation destination and group", () => {
    for (const g of NAVIGATION) {
      expect(MESSAGES.nl).toHaveProperty(`nav.group.${g.group}`);
      for (const it of g.items) expect(MESSAGES.nl).toHaveProperty(`nav.${it.to}`);
    }
  });
  it("uses a stored choice, then the browser language, else English", () => {
    expect(resolveLocale("fr", "nl-BE,nl;q=0.9")).toBe("fr");
    expect(resolveLocale(undefined, "nl-BE,nl;q=0.9,en;q=0.8")).toBe("nl");
    expect(resolveLocale("de", "de-DE")).toBe("en");
  });
  it("fills placeholders and falls back to the key text", () => {
    expect(translate("nl", "home.attentionCount", { n: 3 })).toBe("3 punten om op te volgen");
    expect(translate("fr", "status.expired")).toBe("Accès expiré");
  });
});
