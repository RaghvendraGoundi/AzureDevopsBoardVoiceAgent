import { beforeEach, describe, expect, it } from "vitest";
import { EmulatedBoard, memoryStorage } from "./emulatedBoard";

let board: EmulatedBoard;
const NOW = new Date("2026-10-31T12:00:00Z");

beforeEach(() => {
  board = new EmulatedBoard(memoryStorage(), "Test User", () => NOW);
});

const input = (over: Record<string, unknown> = {}) => ({
  title: "Add logging",
  type: "Task",
  assignedTo: null,
  iterationPath: "Contoso\\Sprint 42",
  areaPath: "Contoso\\Platform",
  ...over,
});

describe("EmulatedBoard context", () => {
  it("emulates the Agile process with a sprint running today", async () => {
    const ctx = await board.context();
    expect(ctx.hierarchy.map((l) => l.types[0])).toEqual(["Epic", "Feature", "User Story", "Task"]);
    const current = ctx.sprints.find((s) => s.timeFrame === "current")!;
    expect(current.name).toBe("Sprint 42");
    expect(new Date(current.startDate!) <= NOW && NOW <= new Date(current.finishDate!)).toBe(true);
    expect(ctx.me.displayName).toBe("Test User");
  });
});

describe("EmulatedBoard queries", () => {
  it("filters by me, sprint and state, and derives category, sprint and parent title", async () => {
    const items = await board.query({ assignee: { kind: "me" }, iteration: "Contoso\\Sprint 42", states: ["Active"] });
    expect(items.length).toBeGreaterThan(2);
    expect(items.every((i) => i.assignedTo?.displayName === "Test User" && i.sprintName === "Sprint 42" && i.stateCategory === "InProgress")).toBe(true);
    const task = items.find((i) => i.id === 1035)!;
    expect(task.parentTitle).toBe("Implement authentication");
  });

  it("finds unplanned items on the backlog and children by parent", async () => {
    const backlog = await board.query({ iteration: "backlog" });
    expect(backlog.every((i) => i.sprintName === null)).toBe(true);
    expect(backlog.map((i) => i.type)).toContain("Feature");
    expect((await board.query({ parentId: 1024 })).map((i) => i.id).sort()).toEqual([1035, 1036]);
  });

  it("matches every search word in the title, or an id", async () => {
    expect((await board.query({ text: "rate limiting" })).map((i) => i.id)).toEqual([1026]);
    expect((await board.query({ text: "1025" }))[0].id).toBe(1025);
  });

  it("returns an item with its parent chain and children", async () => {
    const d = (await board.getDetail(1035))!;
    expect(d.ancestors.map((a) => a.type)).toEqual(["User Story", "Feature", "Epic"]);
    expect((await board.getDetail(1024))!.children.map((c) => c.id).sort()).toEqual([1035, 1036]);
  });
});

describe("EmulatedBoard writes", () => {
  it("creates items in the type's first state with sequential ids", async () => {
    const a = await board.create(input({ parentId: 1024 }));
    const b = await board.create(input({ title: "Another", type: "Bug" }));
    expect(b.id).toBe(a.id + 1);
    expect(a).toMatchObject({ state: "New", stateCategory: "Proposed", parentTitle: "Implement authentication", sprintName: "Sprint 42" });
  });

  it("rejects unknown types, missing parents and short titles", async () => {
    await expect(board.create(input({ type: "Spaceship" }))).rejects.toMatchObject({ code: "invalid" });
    await expect(board.create(input({ parentId: 9999 }))).rejects.toMatchObject({ code: "not_found" });
    await expect(board.create(input({ title: "x" }))).rejects.toMatchObject({ code: "invalid" });
  });

  it("updates state, sprint and parent and bumps the revision", async () => {
    const item = await board.update(1036, { state: "Active", iterationPath: "Contoso\\Sprint 43", parentId: 1034 }, 1);
    expect(item).toMatchObject({ state: "Active", sprintName: "Sprint 43", parentTitle: "Rate limit the public API", rev: 2 });
  });

  it("refuses states the type doesn't have and stale revisions", async () => {
    await expect(board.update(1036, { state: "Resolved" })).rejects.toMatchObject({ code: "invalid_transition" }); // tasks have no Resolved
    await expect(board.update(1036, { title: "Renamed task" }, 7)).rejects.toMatchObject({ code: "conflict" });
  });

  it("persists across instances sharing storage", async () => {
    const storage = memoryStorage();
    const first = new EmulatedBoard(storage, "Test User", () => NOW);
    const created = await first.create(input());
    const second = new EmulatedBoard(storage, "Test User", () => NOW);
    expect((await second.get(created.id))?.title).toBe("Add logging");
  });
});
