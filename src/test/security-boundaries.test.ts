// Code-wide security boundaries, checked on every test run (and in CI): a change that crosses one fails here.
// These read the source as text; they complement, not replace, the database RLS suites and behavior tests.
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { describe, expect, it } from "vitest";

const ROOT = join(__dirname, "..");
function files(dir: string): string[] {
  return readdirSync(dir).flatMap((n) => {
    const p = join(dir, n);
    if (statSync(p).isDirectory()) return n === "test" || n === "generated" ? [] : files(p);
    return /\.(ts|tsx)$/.test(n) && !/\.test\.tsx?$/.test(n) ? [p] : [];
  });
}
const SRC = files(ROOT).map((p) => ({ path: relative(ROOT, p).replaceAll("\\", "/"), text: readFileSync(p, "utf8") }));
const using = (re: RegExp) => SRC.filter((f) => re.test(f.text)).map((f) => f.path).sort();
const generatedClient = (p: string) => p.startsWith("integrations/supabase/");

describe("security boundaries in app code", () => {
  it("has source files to check", () => expect(SRC.length).toBeGreaterThan(100));

  it("never imports the privileged (service-role) database client", () => {
    expect(using(/integrations\/supabase\/client\.server/).filter((p) => !generatedClient(p))).toEqual([]);
  });

  it("never reads staging-only secrets, so the live app cannot use staging credentials", () => {
    expect(using(/STAGING_(DB_MIGRATION_URL|AI_ACCOUNTING_SECRET|SUPABASE_PUBLISHABLE_KEY)/)).toEqual([]);
  });

  it("mentions the service-role key only in the generated client and the environment guard that refuses it", () => {
    expect(using(/SERVICE_ROLE/)).toEqual(["integrations/supabase/client.server.ts", "lib/environment.ts"]);
  });

  it("exposes no secret-looking build variables to the browser", () => {
    const names = [...new Set(SRC.flatMap((f) => [...f.text.matchAll(/import\.meta\.env(?:\.|\[["'])([A-Z0-9_]+)/g)].map((m) => m[1])))];
    expect(names.filter((n) => /SECRET|TOKEN|PASSWORD|SERVICE|PRIVATE/.test(n ?? ""))).toEqual([]);
  });

  it("reads server settings only in server-only modules", () => {
    const ok = (p: string) => generatedClient(p) || p === "start.ts" || /\.functions\.ts$|\.server\.ts$/.test(p);
    expect(using(/process\.env/).filter((p) => !ok(p))).toEqual([]);
  });

  it("reaches the AI provider only through the metered entry point", () => {
    expect(using(/ai\/provider\.server/)).toEqual(["lib/ai.functions.ts"]);
  });

  it("makes outbound network calls only from reviewed server modules", () => {
    const allowed = ["lib/ai.functions.ts", "lib/integrations.functions.ts", "lib/seo.functions.ts", "server.ts"];
    expect(using(/(?<![.\w])fetch\(/).filter((p) => !generatedClient(p) && !allowed.includes(p))).toEqual([]);
  });

  it("renders raw HTML only in the chart style block", () => {
    expect(using(/dangerouslySetInnerHTML/)).toEqual(["components/ui/chart.tsx"]);
  });

  it("keeps the request body limit and the environment guard installed", () => {
    const start = SRC.find((f) => f.path === "start.ts")!.text;
    expect(start).toMatch(/requestMiddleware: \[errorMiddleware, environmentMiddleware, bodyLimitMiddleware, csrfMiddleware\]/);
  });
});
