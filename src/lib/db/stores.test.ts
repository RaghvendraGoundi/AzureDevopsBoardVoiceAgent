import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { Pool } from "pg";
import { PgConversationStore } from "@/lib/conversations/pgStore";
import { DEFAULT_TITLE } from "@/lib/conversations/types";
import { PgTelemetry } from "@/lib/telemetry";
import { PgUserRepo, roleFor } from "@/lib/users/store";
import { testDb } from "./testDb";

let pool: Pool;
let close: () => Promise<void>;

beforeAll(async () => {
  ({ pool, close } = await testDb());
}, 60_000);
afterAll(() => close());

const turn = (id: string, role: "user" | "assistant", text: string, at: number) => ({ id, role, text, at });

describe("PgConversationStore", () => {
  it("keeps each user's conversations separate", async () => {
    const store = new PgConversationStore(async () => pool);
    const a = await store.create("alice");
    await store.append("alice", a.id, { turns: [turn("t1", "user", "Hi", 1000)] });
    await store.create("bob");
    expect((await store.list("alice")).map((c) => c.id)).toEqual([a.id]);
    expect(await store.get("bob", a.id)).toBeNull();
    expect(await store.remove("bob", a.id)).toBe(false);
    expect(await store.append("bob", a.id, { turns: [turn("x", "user", "hijack", 2000)] })).toBeNull();
  });

  it("appends turns once, titles from the first user turn, and keeps changes", async () => {
    const store = new PgConversationStore(async () => pool);
    const c = await store.create("carol");
    const t1 = turn("t1", "user", "What am I working on this sprint?", 1000);
    await store.append("carol", c.id, {
      turns: [t1, turn("t2", "assistant", "Seven items.", 2000)],
      changes: [{ id: "ch1", kind: "created", item: { id: 7, title: "Audit logging", type: "Task" } as never, at: 3000 }],
    });
    await store.append("carol", c.id, { turns: [t1] });
    const got = (await store.get("carol", c.id))!;
    expect(got.turns.map((t) => t.id)).toEqual(["t1", "t2"]);
    expect(got.title).toBe("What am I working on this sprint");
    expect(got.changes[0]).toMatchObject({ id: "ch1", kind: "created", item: { id: 7 } });
    const [summary] = await store.list("carol");
    expect(summary).toMatchObject({ turnCount: 2, preview: "Seven items." });
    expect(await store.remove("carol", c.id)).toBe(true);
    expect(await store.get("carol", c.id)).toBeNull();
  });

  it("doesn't list conversations that never got a message", async () => {
    const store = new PgConversationStore(async () => pool);
    const c = await store.create("dave");
    expect(await store.list("dave")).toEqual([]);
    expect((await store.get("dave", c.id))?.title).toBe(DEFAULT_TITLE);
  });

  it("loses no turns under concurrent saves", async () => {
    const store = new PgConversationStore(async () => pool);
    const c = await store.create("erin");
    await Promise.all(Array.from({ length: 10 }, (_, i) => store.append("erin", c.id, { turns: [turn(`t${i}`, "user", `line ${i}`, 1000 + i)] })));
    expect((await store.get("erin", c.id))!.turns).toHaveLength(10);
  });
});

describe("users and telemetry in Postgres", () => {
  it("records sign-ins, keeps first-seen details, and changes roles", async () => {
    const repo = new PgUserRepo(async () => pool);
    const first = await repo.seen({ userKey: "entra:t:o1", tenantId: "t", objectId: "o1", name: "Alex Morgan", email: "alex@contoso.com" });
    expect(first).toMatchObject({ role: "user", name: "Alex Morgan" });
    await repo.seen({ userKey: "entra:t:o1", name: "Alex M." });
    expect((await repo.get("entra:t:o1"))?.email).toBe("alex@contoso.com");
    expect((await repo.setRole("entra:t:o1", "admin"))?.role).toBe("admin");
    expect(await roleFor("entra:t:o1", "alex@contoso.com", repo, Date.now())).toBe("admin");
    expect((await repo.list()).map((u) => u.userKey)).toContain("entra:t:o1");
  });

  it("summarises recent sessions with their tool calls", async () => {
    const t = new PgTelemetry(async () => pool);
    t.clientEvents("u1", "s1", [{ type: "session_started", at: Date.now(), data: { engine: "realtime", connectedMs: 1800 } }]);
    t.toolCall({ userKey: "u1", sessionId: "s1", tool: "list_work_items", args: {}, ok: true, durationMs: 240 });
    t.toolCall({ userKey: "u1", sessionId: "s1", tool: "get_work_item", args: { id: 1 }, ok: false, error: "timeout", durationMs: 20000 });
    await new Promise((r) => setTimeout(r, 300));
    const [s] = await t.recentSessions(5);
    expect(s).toMatchObject({ id: "s1", engine: "realtime", connectedMs: 1800, toolCalls: 2, toolErrors: 1, slowestToolMs: 20000 });
  });
});
