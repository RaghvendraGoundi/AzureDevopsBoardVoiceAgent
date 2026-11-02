// Database tasks for deploys and maintenance, using the same settings as the app:
//   node scripts/db.mjs migrate          apply db/migrations
//   node scripts/db.mjs purge [days]     delete telemetry and conversations older than
//                                        RETENTION_DAYS (default 90)
// Reads .env.local when present. Managed identity: PG_AUTH=managed-identity with
// PGHOST, PGDATABASE and PGUSER (locally, `az login` supplies the identity).

import { existsSync, readFileSync } from "node:fs";
import pg from "pg";
import { migrate } from "../db/migrate.mjs";

if (existsSync(".env.local")) {
  for (const line of readFileSync(".env.local", "utf8").split("\n")) {
    const m = line.match(/^([A-Z0-9_]+)=(.*)$/);
    if (m && process.env[m[1]] === undefined) process.env[m[1]] = m[2];
  }
}

async function poolConfig() {
  if (process.env.DATABASE_URL) return { connectionString: process.env.DATABASE_URL };
  if (!process.env.PGHOST) throw new Error("Set DATABASE_URL, or PGHOST, PGDATABASE and PGUSER.");
  let password = process.env.PGPASSWORD;
  if (process.env.PG_AUTH === "managed-identity") {
    const { DefaultAzureCredential } = await import("@azure/identity");
    const cred = new DefaultAzureCredential(process.env.AZURE_CLIENT_ID ? { managedIdentityClientId: process.env.AZURE_CLIENT_ID } : undefined);
    password = async () => (await cred.getToken("https://ossrdbms-aad.database.windows.net/.default")).token;
  }
  return {
    host: process.env.PGHOST,
    port: Number(process.env.PGPORT) || 5432,
    database: process.env.PGDATABASE,
    user: process.env.PGUSER,
    password,
    ssl: process.env.PGSSLMODE === "disable" ? false : { rejectUnauthorized: true },
  };
}

const [task = "migrate", arg] = process.argv.slice(2);
const pool = new pg.Pool(await poolConfig());
try {
  if (task === "migrate") {
    const applied = await migrate(pool);
    console.log(applied.length ? `Applied: ${applied.join(", ")}` : "Database is up to date.");
  } else if (task === "purge") {
    const days = Number(arg ?? process.env.RETENTION_DAYS ?? 90);
    if (!Number.isFinite(days) || days < 1) throw new Error("Retention must be at least 1 day.");
    const cutoff = `now() - interval '${Math.floor(days)} days'`;
    for (const [table, column] of [["client_events", "at"], ["tool_calls", "at"], ["voice_sessions", "started_at"], ["conversations", "updated_at"]]) {
      const res = await pool.query(`delete from ${table} where ${column} < ${cutoff}`);
      console.log(`${table}: removed ${res.rowCount} rows older than ${days} days`);
    }
  } else {
    throw new Error(`Unknown task "${task}". Use migrate or purge.`);
  }
} finally {
  await pool.end();
}
