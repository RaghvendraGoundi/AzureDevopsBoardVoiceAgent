import type { Pool } from "pg";
import { db } from "@/lib/db/pool";

/**
 * Telemetry for observability: voice calls, tool calls and client events
 * (connection stages, errors, time to first word). Written to Postgres when
 * configured, otherwise kept in a small in-memory buffer for the admin page.
 * Recording never throws and never slows a request down.
 */

export interface ToolCallRecord {
  userKey: string;
  sessionId?: string | null;
  tool: string;
  /** As the model sent them, with emails already aliased. */
  args: unknown;
  ok: boolean;
  error?: string | null;
  durationMs: number;
}

export interface ClientEvent {
  type: string;
  /** ms since epoch, from the browser. */
  at?: number;
  data?: Record<string, unknown>;
}

export interface SessionSummaryRow {
  id: string;
  userKey: string;
  userName: string | null;
  engine: string | null;
  model: string | null;
  startedAt: number;
  connectedMs: number | null;
  endedAt: number | null;
  endedBy: string | null;
  error: string | null;
  toolCalls: number;
  toolErrors: number;
  slowestToolMs: number | null;
}

export interface Telemetry {
  toolCall(r: ToolCallRecord): void;
  clientEvents(userKey: string, sessionId: string | null, events: ClientEvent[]): void;
  recentSessions(limit?: number): Promise<SessionSummaryRow[]>;
}

const truncate = (s: string | null | undefined, n = 500) => (s ? s.slice(0, n) : null);

export class PgTelemetry implements Telemetry {
  constructor(private readonly pool: () => Promise<Pool>) {}

  private run(label: string, fn: (pool: Pool) => Promise<unknown>) {
    this.pool()
      .then(fn)
      .catch((err: unknown) => console.warn(`[telemetry] ${label} not recorded:`, err instanceof Error ? err.message : err));
  }

  toolCall(r: ToolCallRecord) {
    this.run("tool call", (pool) =>
      pool.query("insert into tool_calls (user_key, session_id, tool, args, ok, error, duration_ms) values ($1, $2, $3, $4, $5, $6, $7)", [
        r.userKey,
        r.sessionId ?? null,
        r.tool,
        JSON.stringify(r.args ?? null),
        r.ok,
        truncate(r.error),
        Math.round(r.durationMs),
      ]),
    );
  }

  clientEvents(userKey: string, sessionId: string | null, events: ClientEvent[]) {
    if (!events.length) return;
    this.run("client events", async (pool) => {
      for (const e of events) {
        const at = e.at ? new Date(e.at) : new Date();
        await pool.query("insert into client_events (at, user_key, session_id, type, data) values ($1, $2, $3, $4, $5)", [
          at,
          userKey,
          sessionId,
          e.type.slice(0, 64),
          JSON.stringify(e.data ?? {}),
        ]);
        if (!sessionId) continue;
        const d = e.data ?? {};
        if (e.type === "session_started") {
          await pool.query(
            `insert into voice_sessions (id, user_key, conversation_id, engine, model, voice, started_at, connected_ms)
             values ($1, $2, $3, $4, $5, $6, $7, $8) on conflict (id) do update set connected_ms = excluded.connected_ms`,
            [sessionId, userKey, d.conversationId ?? null, d.engine ?? null, d.model ?? null, d.voice ?? null, at, d.connectedMs ?? null],
          );
        } else if (e.type === "session_ended" || e.type === "session_failed") {
          await pool.query(
            `insert into voice_sessions (id, user_key, engine, started_at, ended_at, ended_by, error) values ($1, $2, $3, $4, $4, $5, $6)
             on conflict (id) do update set ended_at = excluded.ended_at, ended_by = excluded.ended_by, error = coalesce(excluded.error, voice_sessions.error)`,
            [sessionId, userKey, d.engine ?? null, at, d.endedBy ?? (e.type === "session_failed" ? "error" : null), truncate(d.error as string | undefined)],
          );
        }
      }
    });
  }

  async recentSessions(limit = 50): Promise<SessionSummaryRow[]> {
    const { rows } = await (await this.pool()).query(
      `select s.*, u.name as user_name,
              (select count(*)::int from tool_calls t where t.session_id = s.id) as tool_calls,
              (select count(*)::int from tool_calls t where t.session_id = s.id and not t.ok) as tool_errors,
              (select max(duration_ms) from tool_calls t where t.session_id = s.id) as slowest
         from voice_sessions s left join users u on u.user_key = s.user_key
        order by s.started_at desc limit $1`,
      [limit],
    );
    return rows.map((r) => ({
      id: r.id,
      userKey: r.user_key,
      userName: r.user_name,
      engine: r.engine,
      model: r.model,
      startedAt: new Date(r.started_at).getTime(),
      connectedMs: r.connected_ms,
      endedAt: r.ended_at ? new Date(r.ended_at).getTime() : null,
      endedBy: r.ended_by,
      error: r.error,
      toolCalls: r.tool_calls,
      toolErrors: r.tool_errors,
      slowestToolMs: r.slowest,
    }));
  }
}

/** Without a database: the last few hundred records, in memory. */
export class MemoryTelemetry implements Telemetry {
  readonly tools: Array<ToolCallRecord & { at: number }> = [];
  readonly sessions = new Map<string, SessionSummaryRow>();

  toolCall(r: ToolCallRecord) {
    this.tools.unshift({ ...r, at: Date.now() });
    this.tools.splice(500);
  }

  clientEvents(userKey: string, sessionId: string | null, events: ClientEvent[]) {
    if (!sessionId) return;
    for (const e of events) {
      const d = e.data ?? {};
      const s = this.sessions.get(sessionId) ?? {
        id: sessionId,
        userKey,
        userName: null,
        engine: (d.engine as string) ?? null,
        model: (d.model as string) ?? null,
        startedAt: e.at ?? Date.now(),
        connectedMs: null,
        endedAt: null,
        endedBy: null,
        error: null,
        toolCalls: 0,
        toolErrors: 0,
        slowestToolMs: null,
      };
      if (e.type === "session_started") s.connectedMs = (d.connectedMs as number) ?? null;
      if (e.type === "session_ended" || e.type === "session_failed") {
        s.endedAt = e.at ?? Date.now();
        s.endedBy = (d.endedBy as string) ?? (e.type === "session_failed" ? "error" : null);
        s.error = (d.error as string) ?? s.error;
      }
      this.sessions.set(sessionId, s);
    }
    while (this.sessions.size > 200) this.sessions.delete(this.sessions.keys().next().value!);
  }

  async recentSessions(limit = 50) {
    return [...this.sessions.values()]
      .map((s) => {
        const calls = this.tools.filter((t) => t.sessionId === s.id);
        return { ...s, toolCalls: calls.length, toolErrors: calls.filter((c) => !c.ok).length, slowestToolMs: calls.length ? Math.max(...calls.map((c) => c.durationMs)) : null };
      })
      .sort((a, b) => b.startedAt - a.startedAt)
      .slice(0, limit);
  }
}

const globalForTelemetry = globalThis as unknown as { __telemetry?: Telemetry };

export function getTelemetry(): Telemetry {
  globalForTelemetry.__telemetry ??= db() ? new PgTelemetry(() => db()!) : new MemoryTelemetry();
  return globalForTelemetry.__telemetry;
}
