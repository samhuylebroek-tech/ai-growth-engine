import { describe, expect, it } from "vitest";
import { translate } from "@/lib/i18n/messages";
import { AGENTS } from "@/lib/registry/agents";
import { CAPABILITIES } from "@/lib/registry/capabilities";
import { agentText, capText } from "@/lib/i18n/registry-text";

const tr = (l: "en" | "nl" | "fr") => (k: string) => translate(l, k);

describe("specialist and capability names follow the interface language", () => {
  it("shows the Dutch capability name on approvals", () => {
    const c = CAPABILITIES.find((x) => x.key === "strategy.recommend")!;
    expect(capText(tr("nl"), c).name).toBe("Groeiacties aanbevelen");
    expect(capText(tr("fr"), c).name).toBe("Recommander des actions de croissance");
  });
  it("every registered specialist and capability has a Dutch and French name and description", () => {
    for (const l of ["nl", "fr"] as const) {
      for (const a of AGENTS) {
        expect(translate(l, `reg.agent.${a.key}.name`)).not.toBe(`reg.agent.${a.key}.name`);
        expect(translate(l, `reg.agent.${a.key}.desc`)).not.toBe(`reg.agent.${a.key}.desc`);
      }
      for (const c of CAPABILITIES) {
        expect(translate(l, `reg.cap.${c.key}.name`)).not.toBe(`reg.cap.${c.key}.name`);
        expect(translate(l, `reg.cap.${c.key}.desc`)).not.toBe(`reg.cap.${c.key}.desc`);
      }
    }
  });
  it("falls back to the registry text for an unknown key", () => {
    expect(agentText(tr("nl"), { key: "unknown_agent", name: "X", description: "Y" })).toEqual({
      name: "X",
      description: "Y",
    });
  });
});
