import type { Pool } from "pg";

export function migrate(pool: Pool, dir?: string): Promise<string[]>;
