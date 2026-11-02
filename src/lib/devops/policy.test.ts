import { beforeEach, describe, expect, it } from "vitest";
import { EmulatedBoard, memoryStorage } from "./emulatedBoard";
import { PendingActionStore } from "./pendingActions";
import { accessNote, policyFor } from "./policy";
import { executeTool, type ToolDeps } from "./tools";

const NOW = new Date("2026-10-31T12:00:00Z");
let deps: ToolDeps;

beforeEach(() => {
  deps = {
    board: new EmulatedBoard(memoryStorage(), "Test User", () => NOW),
    actions: new PendingActionStore(),
    userKey: "user-a",
    policy: policyFor("user"),
  };
});

const run = (name: string, args: unknown) => executeTool(name, args, deps);
type Brief = { id: number; assigned_to: string | null };

describe("a regular user", () => {
  it("only lists their own items, whatever they ask for", async () => {
    const mine = await run("list_work_items", { sprint: "any", state: "all" });
    expect((mine.output.items as Brief[]).every((i) => i.assigned_to === "Test User")).toBe(true);
    const search = await run("list_work_items", { search: "rate limit" });
    expect((search.output.items as Brief[]).every((i) => i.assigned_to === "Test User")).toBe(true);
    const other = await run("list_work_items", { assignee: "Priya" });
    expect(other.output).toMatchObject({ ok: false, code: "forbidden" });
  });

  it("sees only the title and place in the hierarchy of someone else's item", async () => {
    const r = await run("get_work_item", { id: 1037 }); // Priya's task
    expect(r.output).toMatchObject({ ok: true, restricted: true, item: { id: 1037 } });
    expect(JSON.stringify(r.output)).not.toContain("Publish limits");
    expect(r.uiEvents[0]).toMatchObject({ type: "work_item_detail", detail: { restricted: true, description: "", comments: [] } });
    const own = await run("get_work_item", { id: 1024 });
    expect(own.output.restricted).toBeUndefined();
  });

  it("can't change or comment on someone else's item", async () => {
    expect((await run("propose_update_work_item", { id: 1037, state: "done" })).output).toMatchObject({ ok: false, code: "forbidden" });
    expect((await run("propose_delete_comment", { id: 1037, comment_id: 1 })).output).toMatchObject({ ok: false, code: "forbidden" });
    expect((await run("propose_update_work_item", { id: 1024, comment: "mine" })).output).toMatchObject({ ok: true });
  });

  it("creates items for themselves only", async () => {
    const forOther = await run("propose_create_work_item", { title: "Help Priya", parent_id: 1024, assignee: "Priya" });
    expect(forOther.output).toMatchObject({ ok: false, code: "forbidden" });
    const own = await run("propose_create_work_item", { title: "My follow-up", parent_id: 1024 });
    expect(own.output).toMatchObject({ ok: true });
  });

  it("is checked again at confirm time", async () => {
    const p = await run("propose_update_work_item", { id: 1024, state: "done" });
    // Reassigned to someone else before the user says yes.
    await deps.board.update(1024, { assignedTo: { displayName: "Priya Shah", uniqueName: "priya.shah@contoso.com" } });
    const r = await run("confirm_action", { action_id: p.output.action_id });
    expect(r.output).toMatchObject({ ok: false, code: "forbidden" });
    expect((await deps.board.get(1024))?.state).not.toBe("Closed");
  });
});

describe("an admin", () => {
  it("sees and changes anyone's items", async () => {
    deps.policy = policyFor("admin");
    const other = await run("list_work_items", { assignee: "Priya", sprint: "any" });
    expect((other.output.items as Brief[]).length).toBeGreaterThan(0);
    expect((await run("get_work_item", { id: 1037 })).output.restricted).toBeUndefined();
    expect((await run("propose_update_work_item", { id: 1037, state: "done" })).output).toMatchObject({ ok: true });
  });
});

describe("accessNote", () => {
  it("tells the model what the user may do", () => {
    expect(accessNote("user")).toMatch(/only see and change work items assigned to them/);
    expect(accessNote("admin")).toMatch(/anyone's work items/);
  });
});
