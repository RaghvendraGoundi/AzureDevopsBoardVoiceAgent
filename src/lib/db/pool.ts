import { Pool, type PoolConfig } from "pg";
import { migrate } from "../../../db/migrate.mjs";
import { getAzureToken, POSTGRES_SCOPE } from "@/lib/azure/credential";

/**
 * Azure Database for PostgreSQL (or any Postgres) for conversations, users
 * and telemetry. Optional: without settings the app keeps its local files.
 *
 * - DATABASE_URL: a connection string (e.g. local Docker Postgres).
 * - Or PGHOST, PGDATABASE, PGUSER (PGPORT) with PG_AUTH=managed-identity: the
 *   password is an Entra token from the app's managed identity, fetched for
 *   each new connection (tokens last about an hour). PGUSER is the identity's
 *   Postgres role name.
 *
 * Migrations run once per process before the first query, unless
 * DB_AUTO_MIGRATE=false (then run `npm run db:migrate` when deploying).
 */

export function dbConfigured(env = process.env): boolean {
  return !!env.DATABASE_URL?.trim() || !!env.PGHOST?.trim();
}

export function poolConfig(env = process.env): PoolConfig {
  const base: PoolConfig = { max: Number(env.PG_POOL_MAX) || 10, idleTimeoutMillis: 30_000, connectionTimeoutMillis: 10_000 };
  if (env.DATABASE_URL?.trim()) return { ...base, connectionString: env.DATABASE_URL.trim() };
  const managed = env.PG_AUTH?.trim().toLowerCase() === "managed-identity";
  return {
    ...base,
    host: env.PGHOST,
    port: Number(env.PGPORT) || 5432,
    database: env.PGDATABASE,
    user: env.PGUSER,
    password: managed ? () => getAzureToken(POSTGRES_SCOPE) : env.PGPASSWORD,
    // Azure requires TLS; PGSSLMODE=disable is for a local server only.
    ssl: env.PGSSLMODE === "disable" ? false : { rejectUnauthorized: true },
  };
}

const globalForDb = globalThis as unknown as { __pgPool?: Pool; __pgReady?: Promise<Pool> };

/** The shared pool, migrated and ready; null when no database is configured. */
export function db(): Promise<Pool> | null {
  if (!dbConfigured()) return null;
  if (!globalForDb.__pgReady) {
    const pool = (globalForDb.__pgPool ??= new Pool(poolConfig()));
    pool.on("error", (err) => console.error("[db] idle client error:", err.message));
    const auto = process.env.DB_AUTO_MIGRATE?.trim().toLowerCase() !== "false";
    globalForDb.__pgReady = (auto ? migrate(pool) : Promise.resolve([]))
      .then((applied) => {
        if (applied.length) console.info(`[db] applied migrations: ${applied.join(", ")}`);
        return pool;
      })
      .catch((err: unknown) => {
        // Let the next request try again rather than failing forever.
        globalForDb.__pgReady = undefined;
        throw err;
      });
  }
  return globalForDb.__pgReady;
}

/** For tests and scripts: a pool on a given connection string. */
export function poolFor(connectionString: string): Pool {
  return new Pool({ connectionString, max: 4 });
}
