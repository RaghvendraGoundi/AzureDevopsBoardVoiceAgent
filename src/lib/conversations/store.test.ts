import { describe, expect, it } from "vitest";
import { ConversationStore, historySection, memoryConversations } from "./store";
import { DEFAULT_TITLE, titleFrom } from "./types";

const turn = (id: string, role: "user" | "assistant", text: string, at: number) => ({ id, role, text, at });

describe("ConversationStore", () => {
  it("keeps each user's conversations separate", async () => {
    const store = new ConversationStore(memoryConversations());
    const a = await store.create("alice");
    await store.create("bob");
    expect((await store.list("alice")).map((c) => c.id)).toEqual([a.id]);
    expect(await store.get("bob", a.id)).toBeNull();
    expect(await store.remove("bob", a.id)).toBe(false);
  });

  it("appends turns once, titles from the first thing the user said, and lists newest first", async () => {
    let now = 1000;
    const store = new ConversationStore(memoryConversations(), () => now);
    const first = await store.create("u");
    now = 2000;
    const second = await store.create("u");
    now = 3000;
    const t1 = turn("t1", "user", "What am I working on this sprint?", 1);
    await store.append("u", first.id, { turns: [t1, turn("t2", "assistant", "Seven items.", 2)] });
    await store.append("u", first.id, { turns: [t1] }); // saved twice by a retry
    const c = (await store.get("u", first.id))!;
    expect(c.turns.map((t) => t.id)).toEqual(["t1", "t2"]);
    expect(c.title).toBe("What am I working on this sprint");
    expect((await store.list("u")).map((x) => x.id)).toEqual([first.id, second.id]);
    expect((await store.list("u"))[1].title).toBe(DEFAULT_TITLE);
  });

  it("serialises concurrent saves so no turn is lost", async () => {
    const store = new ConversationStore(memoryConversations());
    const c = await store.create("u");
    await Promise.all(Array.from({ length: 20 }, (_, i) => store.append("u", c.id, { turns: [turn(`t${i}`, "user", `line ${i}`, i)] })));
    expect((await store.get("u", c.id))!.turns).toHaveLength(20);
  });
});

describe("historySection", () => {
  it("gives the model recent turns and changes, newest kept when long", () => {
    const turns = Array.from({ length: 50 }, (_, i) => turn(`t${i}`, i % 2 ? "assistant" : "user", `line ${i}`, i));
    const text = historySection(
      {
        id: "c",
        title: "x",
        createdAt: 0,
        updatedAt: 0,
        turns,
        changes: [{ id: "ch", kind: "created", item: { id: 273, type: "Task", title: "Add audit logging", state: "New" } as never, at: 1 }],
      },
      30,
    )!;
    expect(text).toMatch(/^# Earlier in this conversation/);
    expect(text).toContain("Assistant: line 49");
    expect(text).not.toContain("line 19\n");
    expect(text).toContain("created Task #273 “Add audit logging”");
    expect(historySection(null)).toBeNull();
  });

  it("makes short titles", () => {
    expect(titleFrom("create a task to add audit logging under the Entra ID sign-in story.")).toBe("Create a task to add audit logging under…");
  });
});
