// Applies db/migrations/*.sql in name order, once each, recorded in
// schema_migrations. Shared by the app (on first database use) and by
// `npm run db:migrate`. An advisory lock keeps two instances from migrating
// at the same time.

import { readdir, readFile } from "node:fs/promises";
import path from "node:path";

const LOCK_ID = 846_513_027;

/**
 * @param {import("pg").Pool} pool
 * @param {string} [dir]
 * @returns {Promise<string[]>} the migrations applied by this run
 */
export async function migrate(pool, dir = path.join(process.cwd(), "db", "migrations")) {
  const client = await pool.connect();
  const applied = [];
  try {
    await client.query("select pg_advisory_lock($1)", [LOCK_ID]);
    await client.query(
      "create table if not exists schema_migrations (name text primary key, applied_at timestamptz not null default now())",
    );
    const done = new Set((await client.query("select name from schema_migrations")).rows.map((r) => r.name));
    const files = (await readdir(dir)).filter((f) => f.endsWith(".sql")).sort();
    for (const file of files) {
      if (done.has(file)) continue;
      const sql = await readFile(path.join(dir, file), "utf8");
      await client.query("begin");
      try {
        await client.query(sql);
        await client.query("insert into schema_migrations (name) values ($1)", [file]);
        await client.query("commit");
        applied.push(file);
      } catch (err) {
        await client.query("rollback");
        throw new Error(`Migration ${file} failed: ${err instanceof Error ? err.message : err}`);
      }
    }
  } finally {
    await client.query("select pg_advisory_unlock($1)", [LOCK_ID]).catch(() => undefined);
    client.release();
  }
  return applied;
}
