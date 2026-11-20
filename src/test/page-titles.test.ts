import { describe, expect, it } from "vitest";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { translate } from "@/lib/i18n/messages";
import type { MessageKey } from "@/lib/i18n/messages";

const files = (dir: string): string[] =>
  readdirSync(dir).flatMap((f) => {
    const p = join(dir, f);
    return statSync(p).isDirectory() ? files(p) : p.endsWith(".tsx") ? [p] : [];
  });

describe("browser tab titles follow the interface language", () => {
  it("translates the goals page title into Dutch and French", () => {
    expect(translate("nl", "head.goals.t" as MessageKey)).toBe("Doelen & budget");
    expect(translate("fr", "head.goals.t" as MessageKey)).toBe("Objectifs et budget");
    expect(translate("en", "head.goals.t" as MessageKey)).toBe("Goals & budget");
  });
  it("no page sets a fixed English title anymore", () => {
    const fixed = files("src/routes").filter((f) => /pageHead\(\s*"/.test(readFileSync(f, "utf8")) || /\{ title: "[^"]*AI Growth Engine"/.test(readFileSync(f, "utf8")));
    expect(fixed.filter((f) => !f.endsWith("__root.tsx"))).toEqual([]);
  });
  it("every localHead key used by a page exists in all three languages", () => {
    const keys = files("src/routes").flatMap((f) => [...readFileSync(f, "utf8").matchAll(/localHead\("([a-z]+)"\)/g)].map((m) => m[1]!));
    expect(keys.length).toBeGreaterThan(30);
    for (const k of keys)
      for (const l of ["en", "nl", "fr"] as const) {
        expect(translate(l, `head.${k}.t` as MessageKey)).not.toBe(`head.${k}.t`);
        expect(translate(l, `head.${k}.d` as MessageKey)).not.toBe(`head.${k}.d`);
      }
  });
});
