// Staging-only demo context for end-to-end tests: one goal, one strategy and an approved plan
// with initiatives in "Staging Bakery", created through the same functions the app uses, acting as the QA owner.
// Idempotent: does nothing when the goal already exists. All titles start with "QA:".
import { connectStaging } from "./db";

const { sql } = await connectStaging();
const result = await sql.begin(async (tx) => {
  const [owner] = await tx`select id from auth.users where email = 'qa-owner@staging.example.com'`;
  if (!owner) throw new Error("run seed-users.ts first");
  const [ws] = await tx`select w.id, w.org_id from public.workspaces w join public.organizations o on o.id = w.org_id where o.name = 'Staging Bakery' and o.created_by = ${owner.id} order by w.created_at limit 1`;
  const [existing] = await tx`select id from public.growth_goals where workspace_id = ${ws.id} and title = 'QA: Grow qualified leads'`;
  if (existing) return { status: "existing" };
  await tx`select set_config('request.jwt.claims', ${JSON.stringify({ sub: owner.id, role: "authenticated" })}, true)`;
  await tx`set local role authenticated`;
  const [g] = await tx`insert into public.growth_goals(org_id, workspace_id, title) values (${ws.org_id}, ${ws.id}, 'QA: Grow qualified leads') returning id`;
  const body = { summary: "QA: more qualified leads through search and partners", actions: [
    { title: "QA: Fix SEO basics", detail: "Titles, descriptions and internal links", channel: "seo", week: 2, effort: "medium" },
    { title: "QA: Partner outreach", detail: "Ten local partners", channel: "partnerships", week: 4, effort: "high" } ] };
  const [s] = await tx`insert into public.growth_strategies(org_id, workspace_id, goal_id, request_key, summary, body) values (${ws.org_id}, ${ws.id}, ${g.id}, gen_random_uuid(), 'QA: Lead plan', ${sql.json(body)}) returning id`;
  const [d] = await tx`select public.create_growth_plan_draft(${s.id}) as r`;
  await tx`select public.approve_growth_plan(${(d.r as { plan_id: string }).plan_id})`;
  await tx`reset role`;
  const [n] = await tx`select count(*)::int as n from public.growth_initiatives where goal_id = ${g.id}`;
  return { status: "created", initiatives: n.n };
});
await sql.end();
console.log(JSON.stringify(result));
