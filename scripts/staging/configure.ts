// Staging-only configuration that is intentionally NOT a migration:
//  1. private storage buckets with the limits the app enforces;
//  2. the staging AI accounting verifier (hash of STAGING_AI_ACCOUNTING_SECRET; plaintext never stored or printed).
// Idempotent. Refuses to run unless the target and in-database identity marker are the verified staging project.
import { createHash, randomBytes } from "node:crypto";
import { connectStaging } from "./db";

const PRODUCTION_VERIFIER_HASH = "d26dfd0deb7502eb4c3f491d74ce10db48f0d2582470ce69895e92148d4b21a3";
const secret = process.env.STAGING_AI_ACCOUNTING_SECRET;
if (!secret || secret.length < 32)
  throw new Error("STAGING_AI_ACCOUNTING_SECRET missing or too short");
if (process.env.AI_ACCOUNTING_SECRET && secret === process.env.AI_ACCOUNTING_SECRET)
  throw new Error("staging secret must differ from production");
const hash = createHash("sha256").update(secret, "utf8").digest("hex");
if (!/^[0-9a-f]{64}$/.test(hash) || hash === PRODUCTION_VERIFIER_HASH)
  throw new Error("staging verifier hash invalid");

const { sql } = await connectStaging();
const DOCS_MIME = [
  "application/pdf",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  "text/csv",
  "text/plain",
  "text/markdown",
  "text/x-markdown",
];
await sql.begin(async (tx) => {
  await tx`insert into storage.buckets(id, name, public, file_size_limit, allowed_mime_types)
    values ('documents','documents', false, ${20 * 1024 * 1024}, ${DOCS_MIME})
    on conflict (id) do update set public=false, file_size_limit=excluded.file_size_limit, allowed_mime_types=excluded.allowed_mime_types`;
  await tx`insert into storage.buckets(id, name, public, file_size_limit, allowed_mime_types)
    values ('execution-files','execution-files', false, ${10 * 1024 * 1024}, null)
    on conflict (id) do update set public=false, file_size_limit=excluded.file_size_limit, allowed_mime_types=null`;
  await tx.unsafe(
    `CREATE OR REPLACE FUNCTION public.verify_ai_accounting(_proof text) RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$ BEGIN IF _proof IS NULL OR encode(sha256(convert_to(_proof,'UTF8')),'hex')<>'${hash}' THEN RAISE EXCEPTION 'server accounting verification required'; END IF; END $$`,
  );
  await tx`REVOKE ALL ON FUNCTION public.verify_ai_accounting(text) FROM PUBLIC, anon, authenticated`;
});

// Verification (each probe rolls back).
async function probe(proof: string | null) {
  try {
    await sql.begin(async (tx) => {
      await tx`select public.verify_ai_accounting(${proof})`;
      throw new Error("__rollback_ok");
    });
  } catch (e) {
    return (e as Error).message === "__rollback_ok" ? "accepted" : "rejected";
  }
  return "accepted";
}
const buckets =
  await sql`select id, public, file_size_limit, allowed_mime_types is not null as mime_restricted from storage.buckets order by id`;
const grants =
  await sql`select has_function_privilege('anon','public.verify_ai_accounting(text)','execute') as anon, has_function_privilege('authenticated','public.verify_ai_accounting(text)','execute') as auth`;
console.log(
  JSON.stringify(
    {
      buckets,
      verifier: {
        stagingSecret: await probe(secret),
        wrongValue: await probe(randomBytes(32).toString("hex")),
        nullValue: await probe(null),
        anonCanExecute: grants[0].anon,
        authenticatedCanExecute: grants[0].auth,
        hashDiffersFromProduction: hash !== PRODUCTION_VERIFIER_HASH,
      },
    },
    null,
    1,
  ),
);
await sql.end();
