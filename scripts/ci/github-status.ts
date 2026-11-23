// Read-only GitHub synchronization check (public repository, no token). Compares the local branch HEAD with the
// GitHub branch, and reports the pull request and every CI check for that exact commit. Never pushes or fetches.
// Usage: bun scripts/ci/github-status.ts
import { execSync } from "node:child_process";

const REPO = "samhuylebroek-tech/ai-growth-engine";
const sh = (c: string) => execSync(c, { encoding: "utf8" }).trim();
const api = async (path: string) => {
  const r = await fetch(`https://api.github.com/repos/${REPO}${path}`, {
    headers: { accept: "application/vnd.github+json", "user-agent": "ai-growth-engine-sync-check" },
  });
  if (!r.ok) throw new Error(`${path}: HTTP ${r.status}`);
  return r.json();
};

const branch = sh("git branch --show-current");
const local = sh("git rev-parse HEAD");
const dirty = sh("git status --porcelain").length > 0;
console.log(`Branch        ${branch}`);
console.log(`Local HEAD    ${local}${dirty ? " (uncommitted changes present)" : ""}`);

let status = "Unknown";
try {
  const remote = (await api(`/branches/${encodeURIComponent(branch)}`)).commit.sha as string;
  console.log(`GitHub HEAD   ${remote}`);
  if (remote === local) status = "Synchronized";
  else {
    const cmp = await api(`/compare/${remote}...${local}`).catch(() => null);
    status = cmp
      ? `Not synchronized (local ${cmp.ahead_by} ahead, ${cmp.behind_by} behind GitHub)`
      : "Not synchronized (local commit not on GitHub yet)";
  }
} catch (e) {
  console.log(`GitHub HEAD   unavailable: ${(e as Error).message}`);
}
console.log(`Sync          ${status}`);

try {
  const prs = await api(
    `/pulls?state=open&head=${REPO.split("/")[0]}:${encodeURIComponent(branch)}`,
  );
  for (const p of prs)
    console.log(
      `Pull request  #${p.number} ${p.state} → ${p.base.ref} (head ${p.head.sha.slice(0, 7)})`,
    );
  if (!prs.length) console.log("Pull request  none open for this branch");
  const runs = (await api(`/actions/runs?head_sha=${local}&per_page=5`)).workflow_runs as Array<{
    id: number;
    name: string;
    status: string;
    conclusion: string | null;
  }>;
  if (!runs.length) console.log("CI            no run for the local HEAD yet");
  for (const run of runs) {
    console.log(
      `CI run        ${run.name}: ${run.status}${run.conclusion ? ` / ${run.conclusion}` : ""}`,
    );
    const { jobs } = await api(`/actions/runs/${run.id}/jobs`);
    for (const j of jobs) console.log(`  - ${j.name}: ${j.conclusion ?? j.status}`);
  }
} catch (e) {
  console.log(`CI            unavailable: ${(e as Error).message}`);
}
