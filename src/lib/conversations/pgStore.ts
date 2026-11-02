import { randomUUID } from "node:crypto";
import type { Pool } from "pg";
import type { ConversationRepo } from "./store";
import { DEFAULT_TITLE, titleFrom, type Conversation, type ConversationChange, type ConversationSummary, type ConversationTurn } from "./types";

const MAX_CONVERSATIONS = 200;
const MAX_TURNS = 500;
const MAX_CHANGES = 200;

const ms = (d: Date | string) => new Date(d).getTime();

/**
 * Conversations in PostgreSQL (see db/migrations). Every query is scoped to
 * the caller's user key, so a conversation id from someone else finds nothing.
 */
export class PgConversationStore implements ConversationRepo {
  constructor(
    private readonly pool: () => Promise<Pool>,
    private readonly now: () => number = Date.now,
  ) {}

  async list(userKey: string): Promise<ConversationSummary[]> {
    const { rows } = await (await this.pool()).query(
      `select c.id, c.title, c.updated_at,
              (select count(*)::int from conversation_turns t where t.conversation_id = c.id) as turn_count,
              (select t.text from conversation_turns t where t.conversation_id = c.id order by t.at desc limit 1) as last_text
         from conversations c
        where c.user_key = $1
          and exists (select 1 from conversation_turns t where t.conversation_id = c.id)
        order by c.updated_at desc`,
      [userKey],
    );
    return rows.map((r) => ({ id: r.id, title: r.title, updatedAt: ms(r.updated_at), turnCount: r.turn_count, preview: (r.last_text ?? "").slice(0, 80) }));
  }

  async get(userKey: string, id: string): Promise<Conversation | null> {
    const pool = await this.pool();
    const head = await pool.query("select id, title, created_at, updated_at from conversations where id = $1 and user_key = $2", [id, userKey]);
    if (!head.rows[0]) return null;
    const [turns, changes] = await Promise.all([
      pool.query("select id, role, text, at from conversation_turns where conversation_id = $1 order by at", [id]),
      pool.query("select id, kind, item, before, at from conversation_changes where conversation_id = $1 order by at", [id]),
    ]);
    const c = head.rows[0];
    return {
      id: c.id,
      title: c.title,
      createdAt: ms(c.created_at),
      updatedAt: ms(c.updated_at),
      turns: turns.rows.map((t) => ({ id: t.id, role: t.role, text: t.text, at: ms(t.at) })),
      changes: changes.rows.map((x) => ({ id: x.id, kind: x.kind, item: x.item, ...(x.before && { before: x.before }), at: ms(x.at) })),
    };
  }

  async create(userKey: string, title = DEFAULT_TITLE): Promise<Conversation> {
    const now = this.now();
    const id = `conv_${randomUUID()}`;
    const pool = await this.pool();
    await pool.query("insert into conversations (id, user_key, title, created_at, updated_at) values ($1, $2, $3, to_timestamp($4 / 1000.0), to_timestamp($4 / 1000.0))", [
      id,
      userKey,
      title,
      now,
    ]);
    // Drop the oldest beyond the cap.
    await pool.query(
      `delete from conversations where user_key = $1 and id in (
         select id from conversations where user_key = $1 order by updated_at desc offset $2)`,
      [userKey, MAX_CONVERSATIONS],
    );
    return { id, title, createdAt: now, updatedAt: now, turns: [], changes: [] };
  }

  async append(
    userKey: string,
    id: string,
    update: { turns?: ConversationTurn[]; changes?: ConversationChange[]; title?: string },
  ): Promise<ConversationSummary | null> {
    const client = await (await this.pool()).connect();
    try {
      await client.query("begin");
      const head = await client.query("select title from conversations where id = $1 and user_key = $2 for update", [id, userKey]);
      if (!head.rows[0]) {
        await client.query("rollback");
        return null;
      }
      for (const t of update.turns ?? []) {
        if (!t.text.trim()) continue;
        await client.query(
          "insert into conversation_turns (conversation_id, id, role, text, at) values ($1, $2, $3, $4, to_timestamp($5 / 1000.0)) on conflict do nothing",
          [id, t.id, t.role, t.text.slice(0, 4000), t.at],
        );
      }
      for (const ch of update.changes ?? []) {
        await client.query(
          "insert into conversation_changes (conversation_id, id, kind, item, before, at) values ($1, $2, $3, $4, $5, to_timestamp($6 / 1000.0)) on conflict do nothing",
          [id, ch.id, ch.kind, JSON.stringify(ch.item), ch.before ? JSON.stringify(ch.before) : null, ch.at],
        );
      }
      await client.query(
        "delete from conversation_turns where conversation_id = $1 and id in (select id from conversation_turns where conversation_id = $1 order by at desc offset $2)",
        [id, MAX_TURNS],
      );
      await client.query(
        "delete from conversation_changes where conversation_id = $1 and id in (select id from conversation_changes where conversation_id = $1 order by at desc offset $2)",
        [id, MAX_CHANGES],
      );

      let title: string = head.rows[0].title;
      if (update.title?.trim()) title = update.title.trim().slice(0, 120);
      else if (title === DEFAULT_TITLE) {
        const first = await client.query("select text from conversation_turns where conversation_id = $1 and role = 'user' order by at limit 1", [id]);
        if (first.rows[0]) title = titleFrom(first.rows[0].text);
      }
      const now = this.now();
      await client.query("update conversations set title = $2, updated_at = to_timestamp($3 / 1000.0) where id = $1", [id, title, now]);
      const stats = await client.query(
        "select count(*)::int as n, (select text from conversation_turns where conversation_id = $1 order by at desc limit 1) as last from conversation_turns where conversation_id = $1",
        [id],
      );
      await client.query("commit");
      return { id, title, updatedAt: now, turnCount: stats.rows[0].n, preview: (stats.rows[0].last ?? "").slice(0, 80) };
    } catch (err) {
      await client.query("rollback").catch(() => undefined);
      throw err;
    } finally {
      client.release();
    }
  }

  async remove(userKey: string, id: string): Promise<boolean> {
    const res = await (await this.pool()).query("delete from conversations where id = $1 and user_key = $2", [id, userKey]);
    return (res.rowCount ?? 0) > 0;
  }
}
