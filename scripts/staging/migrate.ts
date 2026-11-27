// Applies the committed Drizzle migrations to the verified staging database only.
import { connectStaging } from "./db";

const { sql } = await connectStaging();
const { drizzle } = await import("drizzle-orm/postgres-js");
const { migrate } = await import("drizzle-orm/postgres-js/migrator");
const before = await ledger();
console.log("ledger before:", before);
try {
  await migrate(drizzle(sql), { migrationsFolder: "drizzle/migrations" });
} catch (e) {
  const err = e as {
    message?: string;
    cause?: { message?: string; code?: string; where?: string };
  };
  console.error(
    "MIGRATION FAILED:",
    err.cause?.code ?? "",
    (err.cause?.message ?? err.message ?? "").slice(0, 400),
  );
  if (err.cause?.where) console.error("where:", err.cause.where.slice(0, 300));
  console.log("ledger after failure:", await ledger());
  await sql.end();
  process.exit(1);
}
console.log("ledger after:", await ledger());
await sql.end();

async function ledger() {
  const [r] = await sql`select to_regclass('drizzle.__drizzle_migrations') is not null as has`;
  if (!r.has) return 0;
  const [c] = await sql`select count(*)::int as n from drizzle.__drizzle_migrations`;
  return c.n as number;
}
