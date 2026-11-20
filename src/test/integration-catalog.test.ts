import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { ACTIONS, PROVIDERS, SPECIALIST_INTEGRATIONS, adminToExecute, approvalRequired, actionByType, payloadSchema, preparableActions } from "@/lib/integrations/catalog";
import { SPECIALIST_KEYS } from "@/lib/task-execution";

// The database enforces these rules (proposal 0065); the screens must offer exactly the same ones.
const sql = readFileSync(resolve(process.cwd(), "docs/proposals/0065_integration_hub_and_external_actions.sql"), "utf8");
const fn = (name: string) => { const start = sql.indexOf(`FUNCTION public.${name}(`); return sql.slice(start, sql.indexOf("$$;", start)); };

describe("integration catalogue matches the database rules", () => {
  it("has the same providers, categories and permission levels", () => {
    const rows = [...fn("integration_provider").matchAll(/WHEN '([^']+)' THEN '(\{[^']+\})'/g)].map((m) => ({ key: m[1], ...JSON.parse(m[2]!) as { category: string; levels: string[] } }));
    expect(rows.map((r) => r.key).sort()).toEqual(PROVIDERS.map((p) => p.key).sort());
    for (const r of rows) { const p = PROVIDERS.find((x) => x.key === r.key)!; expect(p.category).toBe(r.category); expect([...p.levels]).toEqual(r.levels); }
  });
  it("has the same action types, levels, providers, expected states and required fields", () => {
    const rows = [...fn("external_action_spec").matchAll(/WHEN '([^']+)' THEN '(\{[^']+\})'/g)].map((m) => ({ type: m[1]!, ...JSON.parse(m[2]!) as { level: string; providers: string[]; state: string; required: string[] } }));
    expect(rows.map((r) => r.type).sort()).toEqual(ACTIONS.map((a) => a.type).sort());
    for (const r of rows) {
      const a = actionByType(r.type)!;
      expect(a.level).toBe(r.level); expect([...a.providers]).toEqual(r.providers); expect(a.state).toBe(r.state);
      expect(a.fields.filter((f) => f.required).map((f) => f.key)).toEqual(r.required);
    }
  });
  it("lets each of the 15 specialists prepare exactly the database's action types", () => {
    const rows = new Map([...fn("specialist_external_actions").matchAll(/WHEN '([^']+)' THEN ARRAY\[([^\]]*)\]/g)].map((m) => [m[1]!, [...m[2]!.matchAll(/'([^']+)'/g)].map((x) => x[1])]));
    expect(Object.keys(SPECIALIST_INTEGRATIONS).sort()).toEqual([...SPECIALIST_KEYS].sort());
    for (const k of SPECIALIST_KEYS) expect([...SPECIALIST_INTEGRATIONS[k].prepares]).toEqual(rows.get(k) ?? []);
  });
});

describe("permission rules", () => {
  it("keeps every real provider read-only in this phase", () => {
    for (const p of PROVIDERS.filter((x) => !x.simulated)) expect([...p.levels]).toEqual(["read"]);
  });
  it("only lets the bounded-autonomy policy approve draft-level actions", () => {
    expect(approvalRequired("draft", 4)).toBe(false);
    expect(approvalRequired("draft", 3)).toBe(true);
    for (const l of ["modify", "execute", "publish", "budget"] as const) expect(approvalRequired(l, 4)).toBe(true);
  });
  it("reserves publishing and budget execution for administrators", () => {
    expect(adminToExecute("publish")).toBe(true); expect(adminToExecute("budget")).toBe(true);
    expect(adminToExecute("draft")).toBe(false); expect(adminToExecute("execute")).toBe(false);
  });
  it("offers a specialist only actions its connection supports", () => {
    expect(preparableActions("crm", "sim.hubspot").map((a) => a.type)).toEqual(["crm.create_task", "crm.update_deal"]);
    expect(preparableActions("crm", "hubspot")).toEqual([]);
    expect(preparableActions("business_analyst", "sim.hubspot")).toEqual([]);
    expect(preparableActions("content", "sim.wordpress").map((a) => a.type)).toEqual(["content.save_draft", "content.publish"]);
  });
  it("validates action details strictly", () => {
    const budget = payloadSchema(actionByType("ads.change_budget")!);
    expect(budget.safeParse({ name: "Spring", daily_budget: "25.50" }).success).toBe(true);
    expect(budget.safeParse({ name: "Spring", daily_budget: "0" }).success).toBe(false);
    expect(budget.safeParse({ name: "Spring", daily_budget: "100001" }).success).toBe(false);
    expect(budget.safeParse({ name: "Spring", daily_budget: "abc" }).success).toBe(false);
    const seo = payloadSchema(actionByType("seo.update_metadata")!);
    expect(seo.safeParse({ url: "not a url", meta_title: "x" }).success).toBe(false);
    expect(seo.safeParse({ url: "https://example.com/a", meta_title: "x", extra: "y" }).success).toBe(false);
    expect(seo.safeParse({ url: "https://example.com/a", meta_title: "" }).success).toBe(false);
  });
});
