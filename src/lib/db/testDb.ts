import { randomUUID } from "node:crypto";
import { Pool } from "pg";
import { migrate } from "../../../db/migrate.mjs";

/**
 * A migrated, empty database for tests: real Postgres when TEST_DATABASE_URL
 * is set (CI runs a postgres:16 service), otherwise PGlite (Postgres compiled
 * to WebAssembly) behind a minimal pg-Pool-compatible adapter. Each call gets
 * its own schema or instance, so tests don't see each other's rows.
 */
export async function testDb(): Promise<{ pool: Pool; close: () => Promise<void> }> {
  const url = process.env.TEST_DATABASE_URL?.trim();
  if (url) {
    const schema = `t_${randomUUID().replace(/-/g, "").slice(0, 12)}`;
    const admin = new Pool({ connectionString: url, max: 1 });
    await admin.query(`create schema ${schema}`);
    await admin.end();
    const pool = new Pool({ connectionString: url, max: 4, options: `-c search_path=${schema}` });
    await migrate(pool);
    return {
      pool,
      close: async () => {
        await pool.query(`drop schema ${schema} cascade`);
        await pool.end();
      },
    };
  }

  const { PGlite } = await import("@electric-sql/pglite");
  const lite = new PGlite();
  // One connection: hand it out to one caller at a time, like a pool of one.
  let queue: Promise<void> = Promise.resolve();
  const run = async (text: string, params?: unknown[]) => {
    if (!params?.length) {
      const results = await lite.exec(text);
      const last = results.at(-1);
      return { rows: last?.rows ?? [], rowCount: last?.affectedRows ?? last?.rows.length ?? 0 };
    }
    const r = await lite.query(text, params);
    return { rows: r.rows, rowCount: r.affectedRows ?? r.rows.length };
  };
  const pool = {
    query: (text: string, params?: unknown[]) => {
      const job = queue.then(() => run(text, params));
      queue = job.then(() => undefined, () => undefined);
      return job;
    },
    connect: () =>
      new Promise((resolve) => {
        queue = queue.then(
          () =>
            new Promise<void>((released) => {
              resolve({ query: run, release: () => released() });
            }),
        );
      }),
    end: () => lite.close(),
    on: () => pool,
  } as unknown as Pool;
  await migrate(pool);
  return { pool, close: () => lite.close() };
}
