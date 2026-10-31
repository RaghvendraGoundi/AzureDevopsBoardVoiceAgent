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

  it("searches the whole board when given words or a parent", async () => {
    expect(items(await run("list_work_items", { search: "dark mode" })).map((i) => i.id)).toEqual([1029]);
    expect(items(await run("list_work_items", { parent_id: 1034 })).map((i) => i.id).sort()).toEqual([1026, 1037]);
  });

  it("explains unknown filters instead of guessing", async () => {
    expect((await run("list_work_items", { type: "spaceship" })).output).toMatchObject({ ok: false, types: expect.any(Array) });
    expect((await run("list_work_items", { sprint: "sprint 99" })).output).toMatchObject({ ok: false, sprints: expect.any(Array) });
    expect((await run("list_work_items", { assignee: "zorro" })).output).toMatchObject({ ok: false, team: expect.any(Array) });
  });
});

describe("get_work_item and get_sprint", () => {
  it("returns the parent chain and numbered children", async () => {
    const r = await run("get_work_item", { id: 1024 });
    expect(r.output.item).toMatchObject({ parents: ["Feature #1010 Secure sign-in (Active)", "Epic #1001 Customer portal v2 (Active)"] });
    expect((r.output.children as Brief[]).map((c) => c.position)).toEqual([1, 2]);
    expect(r.uiEvents[0]).toMatchObject({ type: "work_items_loaded" });
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

  it("creates a task under its story, in the story's sprint, assigned to me", async () => {
    const proposal = await run("propose_create_work_item", { title: "Add logging to sign-in", parent_id: 1024 });
    expect(proposal.output).toMatchObject({ ok: true, defaults_applied: { type: "Task", sprint: "Sprint 42", assignee: "Test User", priority: 2 } });
    const r = await run("confirm_action", { action_id: proposal.output.action_id });
    expect(r.output.created).toMatchObject({ type: "Task", state: "New", sprint: "Sprint 42", parent: "#1024 Implement authentication" });
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
