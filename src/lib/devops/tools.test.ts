import { beforeEach, describe, expect, it } from "vitest";
import { EmulatedBoard, memoryStorage } from "./emulatedBoard";
import { ACTION_TTL_MS, PendingActionStore } from "./pendingActions";
import { executeTool, toolDefinitions, TOOL_NAMES, type ToolDeps } from "./tools";

let now = 0;
let deps: ToolDeps;
const NOW = new Date("2026-10-31T12:00:00Z");

beforeEach(() => {
  now = 1_000_000;
  deps = {
    board: new EmulatedBoard(memoryStorage(), "Test User", () => NOW),
    actions: new PendingActionStore(() => now),
    userKey: "user-a",
  };
});

const run = (name: string, args: unknown) => executeTool(name, args, deps);
type Brief = { id: number; position: number; state: string; type: string; assigned_to: string | null; sprint: string; parent: string | null };
const items = (r: { output: Record<string, unknown> }) => r.output.items as Brief[];

describe("tool definitions", () => {
  it("advertise exactly the executable tools", () => {
    expect(toolDefinitions.map((t) => t.name).sort()).toEqual([...TOOL_NAMES].sort());
  });
});

describe("list_work_items", () => {
  it("defaults to my open items in the current sprint, numbered, with parent and sprint", async () => {
    const r = await run("list_work_items", {});
    const list = items(r);
    expect(list.length).toBeGreaterThan(3);
    expect(list.map((i) => i.position)).toEqual(list.map((_, i) => i + 1));
    expect(list.every((i) => i.assigned_to === "Test User" && i.sprint === "Sprint 42" && i.state !== "Closed")).toBe(true);
    expect(list.find((i) => i.id === 1035)?.parent).toBe("#1024 Implement authentication");
    expect(r.uiEvents[0]).toMatchObject({ type: "work_items_loaded", title: "Your open items · Sprint 42" });
  });

  it("understands spoken filters: done, bug, next sprint, anyone, a teammate", async () => {
    expect(items(await run("list_work_items", { state: "done", sprint: "previous" })).map((i) => i.id)).toEqual([1031]);
    expect(items(await run("list_work_items", { type: "bugs", assignee: "anyone" })).map((i) => i.type)).toEqual(["Bug", "Bug"]);
    expect(items(await run("list_work_items", { sprint: "next", assignee: "anyone" })).map((i) => i.id).sort()).toEqual([1029, 1033]);
    expect(items(await run("list_work_items", { assignee: "priya" })).map((i) => i.id)).toEqual([1037]);
  });

  it("finds titles despite hyphens and filler words", async () => {
    expect(items(await run("list_work_items", { search: "the rate-limiting middleware task" })).map((i) => i.id)).toEqual([1026]);
    expect(items(await run("list_work_items", { search: "#1025" })).map((i) => i.id)).toEqual([1025]);
    // Named items are found even when they're done.
    expect(items(await run("list_work_items", { search: "node runtime" })).map((i) => i.state)).toEqual(["Closed"]);
  });

  it("searches the whole board when given words or a parent", async () => {
    expect(items(await run("list_work_items", { search: "dark mode" })).map((i) => i.id)).toEqual([1029]);
    expect(items(await run("list_work_items", { parent_id: 1034 })).map((i) => i.id).sort()).toEqual([1026, 1031, 1032, 1037]);
  });

  it("explains unknown filters instead of guessing", async () => {
    expect((await run("list_work_items", { type: "spaceship" })).output).toMatchObject({ ok: false, types: expect.any(Array) });
    expect((await run("list_work_items", { sprint: "sprint 99" })).output).toMatchObject({ ok: false, sprints: expect.any(Array) });
    expect((await run("list_work_items", { assignee: "zorro" })).output).toMatchObject({ ok: false, team: expect.any(Array) });
  });
});

describe("list_work_items for portfolio levels", () => {
  it("lists features across the backlog and the whole team by default", async () => {
    const r = await run("list_work_items", { type: "feature" });
    expect(items(r).map((i) => i.id).sort()).toEqual([1010, 1011, 1012]);
  });

  it("falls back to any type when the guessed type has no title match", async () => {
    const r = await run("list_work_items", { type: "feature", search: "customer portal" });
    expect(items(r).map((i) => i.id)).toEqual([1001]);
    expect(r.output.note).toMatch(/No Feature matched/);
  });
});

describe("comments and descriptions", () => {
  const confirm = (p: { output: Record<string, unknown> }) => run("confirm_action", { action_id: p.output.action_id });

  it("adds a comment after a yes, then lists it with its id on the item", async () => {
    await confirm(await run("propose_update_work_item", { id: 1024, comment: "Waiting on the security review" }));
    const r = await run("get_work_item", { id: 1024 });
    const comments = r.output.comments as Array<{ comment_id: number; by: string; text: string }>;
    expect(comments[0]).toMatchObject({ by: "Test User", text: "Waiting on the security review" });
    expect(r.uiEvents[0]).toMatchObject({ type: "work_item_detail", detail: { id: 1024 } });
  });

  it("deletes a comment only after a yes", async () => {
    await confirm(await run("propose_update_work_item", { id: 1024, comment: "Typo comment" }));
    const id = ((await run("get_work_item", { id: 1024 })).output.comments as Array<{ comment_id: number }>)[0].comment_id;
    const p = await run("propose_delete_comment", { id: 1024, comment_id: id });
    expect(p.output).toMatchObject({ ok: true, status: "awaiting_user_confirmation" });
    expect(p.uiEvents[0]).toMatchObject({ type: "work_item_preview", action: { kind: "delete_comment", comment: { text: "Typo comment" } } });
    expect(((await run("get_work_item", { id: 1024 })).output.comments as unknown[]).length).toBe(1);
    const done = await confirm(p);
    expect(done.output).toMatchObject({ ok: true, deleted_comment: id });
    expect((await run("get_work_item", { id: 1024 })).output.comments).toEqual([]);
  });

  it("says which comments exist when the id is wrong", async () => {
    const r = await run("propose_delete_comment", { id: 1024, comment_id: 999 });
    expect(r.output).toMatchObject({ ok: false, comments: [] });
  });

  it("writes a description after a yes and shows it in the preview", async () => {
    const p = await run("propose_update_work_item", { id: 1024, description: "Sign in with Entra ID.\n\n- Session refresh\n- Logout everywhere" });
    expect(String(p.output.summary)).toMatch(/rewrite the description|add a description/);
    await confirm(p);
    expect((await deps.board.get(1024))?.description).toBe("Sign in with Entra ID.\n\n- Session refresh\n- Logout everywhere");
  });
});

describe("get_work_item and get_sprint", () => {
  it("returns the parent chain and numbered children", async () => {
    const r = await run("get_work_item", { id: 1024 });
    expect(r.output.item).toMatchObject({ parents: ["Feature #1010 Secure sign-in (Active)", "Epic #1001 Customer portal v2 (Active)"] });
    expect((r.output.children as Brief[]).map((c) => c.position)).toEqual([1, 2]);
    // The item opens on screen with its parents, children and comments.
    expect(r.uiEvents[0]).toMatchObject({ type: "work_item_detail", detail: { id: 1024, ancestors: [{ id: 1010 }, { id: 1001 }] } });
  });

  it("summarises the current sprint", async () => {
    const r = await run("get_sprint", {});
    expect(r.output).toMatchObject({ ok: true, sprint: "Sprint 42", days_left: expect.any(Number) });
    expect((r.output.my_items as { total: number }).total).toBeGreaterThan(3);
  });
});

describe("argument validation", () => {
  it("rejects unknown tools and bad arguments without touching the board", async () => {
    expect((await run("delete_everything", {})).output).toMatchObject({ ok: false });
    expect((await run("propose_update_work_item", { id: "abc", state: "done" })).output.ok).toBe(false);
    expect((await run("propose_create_work_item", { title: "" })).output.ok).toBe(false);
  });

  it("wait_for_user is a no-op", async () => {
    expect(await run("wait_for_user", {})).toEqual({ output: { ok: true }, uiEvents: [] });
  });
});

describe("update flow", () => {
  it("maps 'done' to this type's state and writes only once, after confirmation", async () => {
    const proposal = await run("propose_update_work_item", { id: 1026, state: "done" });
    expect(proposal.output).toMatchObject({ ok: true, status: "awaiting_user_confirmation" });
    expect((await deps.board.get(1026))?.state).toBe("Active");

    const actionId = proposal.output.action_id;
    const confirmed = await run("confirm_action", { action_id: actionId });
    expect(confirmed.output).toMatchObject({ ok: true, updated: { id: 1026, state: "Closed" } });
    expect(confirmed.uiEvents.map((e) => e.type)).toEqual(["confirmation_resolved", "work_item_updated"]);
    expect((await run("confirm_action", { action_id: actionId })).output.ok).toBe(false);
    expect((await deps.board.get(1026))?.rev).toBe(2);
  });

  it("moves an item to the next sprint and under a new parent, with a comment", async () => {
    const p = await run("propose_update_work_item", { id: 1036, sprint: "next", parent_id: 1034, comment: "Blocked on auth" });
    expect(String(p.output.summary)).toMatch(/Sprint 42 → Sprint 43.*move under #1034/);
    const r = await run("confirm_action", { action_id: p.output.action_id });
    expect(r.output.updated).toMatchObject({ sprint: "Sprint 43", parent: "#1034 Rate limit the public API" });
  });

  it("explains states the type doesn't have, and no-op changes", async () => {
    expect((await run("propose_update_work_item", { id: 1036, state: "resolved" })).output).toMatchObject({
      ok: false,
      valid_states: ["New", "Active", "Closed"],
    });
    expect((await run("propose_update_work_item", { id: 1026, state: "in progress" })).output).toMatchObject({ ok: false, code: "invalid_transition" });
  });

  it("ignores the empty placeholders some models send for unset arguments", async () => {
    const r = await run("list_work_items", { assignee: "me", sprint: "current", state: "open", type: "", parent_id: 0, search: "", tags: [] });
    expect(r.output).toMatchObject({ ok: true, sprint: "Sprint 42" });
    expect((r.output.items as Brief[]).length).toBeGreaterThan(3);
  });

  it("removes a parent only when asked explicitly", async () => {
    const p = await run("propose_update_work_item", { id: 1036, remove_parent: true });
    expect(String(p.output.summary)).toMatch(/remove its parent/);
  });

  it("refuses a parent from the wrong level", async () => {
    const r = await run("propose_update_work_item", { id: 1036, parent_id: 1001 });
    expect(String(r.output.error)).toMatch(/belongs under a User Story/);
  });

  it("refuses a stale proposal if the item changed in between", async () => {
    const proposal = await run("propose_update_work_item", { id: 1026, state: "done" });
    await deps.board.update(1026, { priority: 3 });
    const r = await run("confirm_action", { action_id: proposal.output.action_id });
    expect(r.output).toMatchObject({ ok: false, code: "conflict" });
    expect((await deps.board.get(1026))?.state).toBe("Active");
  });
});

describe("create flow", () => {
  it("asks for a parent, offering my current stories, instead of creating an orphan task", async () => {
    const r = await run("propose_create_work_item", { title: "Add logging to sign-in", type: "task" });
    expect(r.output).toMatchObject({ ok: false, needs_parent: true, parent_types: ["User Story", "Bug"] });
    expect((r.output.candidates as Brief[]).map((c) => c.id)).toContain(1024);
  });

  it("offers backlog features (not just this sprint's) as parents for a new story", async () => {
    const r = await run("propose_create_work_item", { title: "Improve voice agent", type: "story" });
    expect(r.output).toMatchObject({ needs_parent: true, parent_types: ["Feature"] });
    expect((r.output.candidates as Brief[]).map((c) => c.id)).toEqual(expect.arrayContaining([1010, 1011, 1012]));
  });

  it("finds the parent from the words the user said", async () => {
    const p = await run("propose_create_work_item", { title: "Improve voice agent", type: "story", parent: "public API hardening" });
    expect(p.output).toMatchObject({ ok: true });
    expect(String(p.output.summary)).toMatch(/under Feature #1011/);
  });

  it("says when the named parent is at the wrong level", async () => {
    const p = await run("propose_create_work_item", { title: "Improve voice agent", type: "story", parent: "customer portal v2" });
    expect(p.output).toMatchObject({ ok: false, parent_types: ["Feature"] });
    expect(String(p.output.error)).toMatch(/#1001 “Customer portal v2” is an Epic/);
  });

  it("creates a task under its story, in the story's sprint, assigned to me", async () => {
    const proposal = await run("propose_create_work_item", { title: "Add logging to sign-in", parent_id: 1024 });
    expect(proposal.output).toMatchObject({ ok: true, defaults_applied: { type: "Task", sprint: "Sprint 42", assignee: "Test User", priority: 2 } });
    const r = await run("confirm_action", { action_id: proposal.output.action_id });
    expect(r.output.created).toMatchObject({ type: "Task", state: "New", sprint: "Sprint 42", parent: "#1024 Implement authentication" });
  });

  it("never puts a new task into a sprint that has already finished", async () => {
    await deps.board.update(1024, { iterationPath: "Contoso\\Sprint 41" });
    const p = await run("propose_create_work_item", { title: "Add audit logging", parent_id: 1024 });
    expect(p.output.defaults_applied).toMatchObject({ sprint: "Sprint 42" });
  });

  it("puts a feature under an epic on the backlog, unassigned", async () => {
    const p = await run("propose_create_work_item", { title: "Usage analytics", type: "feature", parent_id: 1001 });
    expect(p.output.defaults_applied).toMatchObject({ sprint: "backlog", assignee: "nobody" });
  });

  it("allows a standalone item when the user says so", async () => {
    const p = await run("propose_create_work_item", { title: "One-off cleanup", type: "task", no_parent: true, sprint: "next" });
    expect(p.output).toMatchObject({ ok: true, defaults_applied: { assignee: "Test User" } });
    expect(String(p.output.summary)).toMatch(/in Sprint 43/);
  });

  it("cancel discards the proposal", async () => {
    const proposal = await run("propose_create_work_item", { title: "Throwaway", parent_id: 1024 });
    await run("cancel_action", { action_id: proposal.output.action_id });
    expect((await run("confirm_action", { action_id: proposal.output.action_id })).output.ok).toBe(false);
    expect(await deps.board.query({ text: "throwaway" })).toHaveLength(0);
  });

  it("expired proposals cannot be confirmed", async () => {
    const proposal = await run("propose_create_work_item", { title: "Late task", parent_id: 1024 });
    now += ACTION_TTL_MS + 1;
    const r = await run("confirm_action", { action_id: proposal.output.action_id });
    expect(String(r.output.error)).toMatch(/expired/);
  });

  it("one user can't confirm another user's proposal", async () => {
    const proposal = await run("propose_create_work_item", { title: "Mine only", parent_id: 1024 });
    const other = await executeTool("confirm_action", { action_id: proposal.output.action_id }, { ...deps, userKey: "user-b" });
    expect(other.output.ok).toBe(false);
    expect((await run("confirm_action", { action_id: proposal.output.action_id })).output.ok).toBe(true);
  });
});
