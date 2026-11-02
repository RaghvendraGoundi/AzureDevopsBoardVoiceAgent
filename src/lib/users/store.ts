import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import path from "node:path";
import type { Pool } from "pg";
import { db } from "@/lib/db/pool";

/**
 * Everyone who has signed in, and whether they're an admin. ADMIN_EMAIL (one
 * or more, comma separated) is always admin and can't be demoted; that admin
 * promotes others from /admin. Stored in Postgres when configured, otherwise
 * in .data/users.json.
 */

export type Role = "user" | "admin";

export interface AppUser {
  userKey: string;
  tenantId: string | null;
  objectId: string | null;
  name: string;
  email: string | null;
  role: Role;
  createdAt: number;
  lastSeenAt: number;
}

export interface SeenUser {
  userKey: string;
  tenantId?: string | null;
  objectId?: string | null;
  name: string;
  email?: string | null;
}

export interface UserRepo {
  /** Records a sign-in (or a visit); creates the user on first sight. */
  seen(u: SeenUser): Promise<AppUser>;
  get(userKey: string): Promise<AppUser | null>;
  list(): Promise<AppUser[]>;
  setRole(userKey: string, role: Role): Promise<AppUser | null>;
}

export function bootstrapAdmins(env = process.env): string[] {
  return (env.ADMIN_EMAIL ?? "")
    .split(",")
    .map((e) => e.trim().toLowerCase())
    .filter(Boolean);
}

export const isBootstrapAdmin = (email: string | null | undefined, env = process.env) =>
  !!email && bootstrapAdmins(env).includes(email.trim().toLowerCase());

const ms = (d: Date | string) => new Date(d).getTime();

export class PgUserRepo implements UserRepo {
  constructor(private readonly pool: () => Promise<Pool>) {}

  private row(r: Record<string, unknown>): AppUser {
    return {
      userKey: r.user_key as string,
      tenantId: (r.tenant_id as string) ?? null,
      objectId: (r.object_id as string) ?? null,
      name: r.name as string,
      email: (r.email as string) ?? null,
      role: r.role as Role,
      createdAt: ms(r.created_at as Date),
      lastSeenAt: ms(r.last_seen_at as Date),
    };
  }

  async seen(u: SeenUser) {
    const { rows } = await (await this.pool()).query(
      `insert into users (user_key, tenant_id, object_id, name, email) values ($1, $2, $3, $4, $5)
       on conflict (user_key) do update set name = excluded.name, email = coalesce(excluded.email, users.email), last_seen_at = now()
       returning *`,
      [u.userKey, u.tenantId ?? null, u.objectId ?? null, u.name, u.email ?? null],
    );
    return this.row(rows[0]);
  }

  async get(userKey: string) {
    const { rows } = await (await this.pool()).query("select * from users where user_key = $1", [userKey]);
    return rows[0] ? this.row(rows[0]) : null;
  }

  async list() {
    const { rows } = await (await this.pool()).query("select * from users order by last_seen_at desc");
    return rows.map((r) => this.row(r));
  }

  async setRole(userKey: string, role: Role) {
    const { rows } = await (await this.pool()).query("update users set role = $2 where user_key = $1 returning *", [userKey, role]);
    return rows[0] ? this.row(rows[0]) : null;
  }
}

/** Local runs and tests: one JSON file (or memory). */
export class FileUserRepo implements UserRepo {
  private queue: Promise<unknown> = Promise.resolve();
  private memory: AppUser[] | null = null;

  constructor(
    private readonly file: string | null,
    private readonly now: () => number = Date.now,
  ) {}

  private async load(): Promise<AppUser[]> {
    if (!this.file) return (this.memory ??= []);
    try {
      return JSON.parse(await readFile(this.file, "utf8")) as AppUser[];
    } catch {
      return [];
    }
  }

  private async save(all: AppUser[]) {
    if (!this.file) {
      this.memory = all;
      return;
    }
    await mkdir(path.dirname(this.file), { recursive: true });
    const tmp = `${this.file}.tmp`;
    await writeFile(tmp, JSON.stringify(all, null, 2));
    await rename(tmp, this.file);
  }

  private mutate<T>(fn: (all: AppUser[]) => T): Promise<T> {
    const run = this.queue.then(async () => {
      const all = await this.load();
      const result = fn(all);
      await this.save(all);
      return result;
    });
    this.queue = run.catch(() => undefined);
    return run;
  }

  seen(u: SeenUser) {
    return this.mutate((all) => {
      let user = all.find((x) => x.userKey === u.userKey);
      const now = this.now();
      if (!user) {
        user = { userKey: u.userKey, tenantId: u.tenantId ?? null, objectId: u.objectId ?? null, name: u.name, email: u.email ?? null, role: "user", createdAt: now, lastSeenAt: now };
        all.push(user);
      } else {
        Object.assign(user, { name: u.name, email: u.email ?? user.email, lastSeenAt: now });
      }
      return { ...user };
    });
  }

  async get(userKey: string) {
    return (await this.load()).find((u) => u.userKey === userKey) ?? null;
  }

  async list() {
    return (await this.load()).sort((a, b) => b.lastSeenAt - a.lastSeenAt);
  }

  setRole(userKey: string, role: Role) {
    return this.mutate((all) => {
      const user = all.find((u) => u.userKey === userKey);
      if (user) user.role = role;
      return user ? { ...user } : null;
    });
  }
}

const globalForUsers = globalThis as unknown as { __userRepo?: UserRepo; __roleCache?: Map<string, { role: Role; at: number }> };

export function getUserRepo(): UserRepo {
  globalForUsers.__userRepo ??= db() ? new PgUserRepo(() => db()!) : new FileUserRepo(path.join(process.cwd(), ".data", "users.json"));
  return globalForUsers.__userRepo;
}

const ROLE_TTL_MS = 60_000;

/** The user's role: ADMIN_EMAIL is always admin; otherwise what an admin set (cached for a minute). */
export async function roleFor(userKey: string, email: string | null | undefined, repo = getUserRepo(), now = Date.now()): Promise<Role> {
  if (isBootstrapAdmin(email)) return "admin";
  const cache = (globalForUsers.__roleCache ??= new Map());
  const hit = cache.get(userKey);
  if (hit && now - hit.at < ROLE_TTL_MS) return hit.role;
  const role = (await repo.get(userKey).catch(() => null))?.role ?? "user";
  cache.set(userKey, { role, at: now });
  return role;
}

/** After an admin changes someone's role, so it applies at once on this server. */
export function forgetRole(userKey: string) {
  globalForUsers.__roleCache?.delete(userKey);
}
