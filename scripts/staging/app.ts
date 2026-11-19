// Starts the sandbox-only staging app on http://127.0.0.1:8091 against the staging project.
// Usage: bun scripts/staging/app.ts   (prints only non-secret status lines)
import { spawn } from "node:child_process";
import { openSync } from "node:fs";
import { connectStaging } from "./db";
import { stagingAppEnv, STAGING_URL } from "./app-env";

const env = stagingAppEnv(process.env);
// 1. The database behind the key carries the staging identity marker.
const { sql } = await connectStaging();
await sql.end();
// 2. The publishable key is accepted by the staging project and rejected by the live project.
const probe = (base: string) => fetch(`${base}/auth/v1/settings`, { headers: { apikey: env["VITE_SUPABASE_PUBLISHABLE_KEY"]! } }).then(r => r.status);
if ((await probe(STAGING_URL)) !== 200) throw new Error("staging key is not accepted by the staging project");
const liveUrl = process.env["VITE_SUPABASE_URL"];
if (liveUrl && (await probe(liveUrl.replace(/\/+$/, ""))) === 200) throw new Error("staging key is accepted by the live project; refusing");
const log = openSync("/tmp/staging-app.log", "a");
const child = spawn("bunx", ["--bun", "vite", "dev", "--config", "scripts/staging/vite.config.ts"], { env, stdio: ["ignore", log, log], detached: true });
child.unref();
console.log(JSON.stringify({ started: true, pid: child.pid, url: "http://127.0.0.1:8091", backend: "staging", log: "/tmp/staging-app.log" }));
