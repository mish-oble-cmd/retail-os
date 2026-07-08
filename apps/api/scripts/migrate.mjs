/**
 * Minimal forward-only SQL migration runner (deployment-devops.md: expand-
 * contract; files in src/db/migrations run once, in name order).
 * Usage: DATABASE_URL=... node scripts/migrate.mjs
 */
import { readFileSync, readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import pg from "pg";

const dir = fileURLToPath(new URL("../src/db/migrations", import.meta.url));
const client = new pg.Client({
  connectionString: process.env.DATABASE_URL ?? "postgres://retailos:retailos@localhost:5432/retailos",
});

await client.connect();
await client.query(
  "CREATE TABLE IF NOT EXISTS _migrations (name text PRIMARY KEY, applied_at timestamptz NOT NULL DEFAULT now())",
);

const applied = new Set((await client.query("SELECT name FROM _migrations")).rows.map((r) => r.name));

for (const file of readdirSync(dir).filter((f) => f.endsWith(".sql")).sort()) {
  if (applied.has(file)) continue;
  const sqlText = readFileSync(`${dir}/${file}`, "utf8");
  console.log(`applying ${file}`);
  await client.query("BEGIN");
  try {
    await client.query(sqlText);
    await client.query("INSERT INTO _migrations (name) VALUES ($1)", [file]);
    await client.query("COMMIT");
  } catch (error) {
    await client.query("ROLLBACK");
    console.error(`FAILED ${file}:`, error.message);
    process.exitCode = 1;
    break;
  }
}

await client.end();
