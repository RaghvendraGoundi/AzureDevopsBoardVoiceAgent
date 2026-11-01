import { describe, expect, it } from "vitest";
import {
  categoryFor,
  daysLeft,
  defaultChildType,
  hierarchyLabel,
  parentTypesFor,
  resolvePerson,
  resolveSprint,
  resolveState,
  resolveType,
  searchText,
  statesInCategories,
} from "./process";
import { emulatedContext } from "./seed";

const NOW = new Date("2026-10-31T12:00:00Z");
const ctx = emulatedContext("Test User", NOW);

describe("resolveType", () => {
  it("maps what people say to the process's type names", () => {
    expect(resolveType(ctx, "story")).toBe("User Story");
    expect(resolveType(ctx, "stories")).toBe("User Story");
    expect(resolveType(ctx, "tasks")).toBe("Task");
    expect(resolveType(ctx, "defect")).toBe("Bug");
    expect(resolveType(ctx, "Feature")).toBe("Feature");
    expect(resolveType(ctx, "spaceship")).toBeNull();
  });
});

describe("hierarchy", () => {
  it("knows which types can be a parent and the usual child", () => {
    expect(parentTypesFor(ctx, "Task")).toEqual(["User Story", "Bug"]);
    expect(parentTypesFor(ctx, "User Story")).toEqual(["Feature"]);
    expect(parentTypesFor(ctx, "Epic")).toEqual([]);
    expect(defaultChildType(ctx, "User Story")).toBe("Task");
    expect(defaultChildType(ctx, "Epic")).toBe("Feature");
  });

  it("describes the hierarchy top to bottom", () => {
    expect(hierarchyLabel(ctx)).toBe("Epic → Feature → Stories (User Story) → Task");
  });
});

describe("resolveState", () => {
  it("understands everyday words for states", () => {
    expect(resolveState(ctx, "Task", "done")).toBe("Closed");
    expect(resolveState(ctx, "Task", "in progress")).toBe("Active");
    expect(resolveState(ctx, "User Story", "start")).toBe("Active");
    expect(resolveState(ctx, "Task", "Closed")).toBe("Closed");
    expect(resolveState(ctx, "Task", "banana")).toBeNull();
  });

  it("only offers Removed when asked for it", () => {
    expect(categoryFor("cancelled")).toBe("Removed");
    expect(statesInCategories(ctx, ["Completed"], ["Task"])).toEqual(["Closed"]);
  });
});

describe("resolveSprint", () => {
  it("finds current, next, previous and sprints by number", () => {
    expect(resolveSprint(ctx, "current")?.name).toBe("Sprint 42");
    expect(resolveSprint(ctx, "next sprint")?.name).toBe("Sprint 43");
    expect(resolveSprint(ctx, "last sprint")?.name).toBe("Sprint 41");
    expect(resolveSprint(ctx, "sprint 44")?.name).toBe("Sprint 44");
    expect(resolveSprint(ctx, "44")?.name).toBe("Sprint 44");
    expect(resolveSprint(ctx, "sprint 99")).toBeNull();
  });

  it("counts calendar days left, including today", () => {
    const current = resolveSprint(ctx, "current")!;
    expect(daysLeft(current, NOW)).toBeGreaterThan(0);
  });
});

describe("resolvePerson", () => {
  it("finds teammates by full name, first name or email, and 'me'", () => {
    expect(resolvePerson(ctx, "me")?.displayName).toBe("Test User");
    expect(resolvePerson(ctx, "Priya")?.displayName).toBe("Priya Shah");
    expect(resolvePerson(ctx, "marcus lee")?.displayName).toBe("Marcus Lee");
    expect(resolvePerson(ctx, "someone@contoso.com")?.uniqueName).toBe("someone@contoso.com");
    expect(resolvePerson(ctx, "Nobody Known")).toBeNull();
  });
});

describe("searchText", () => {
  it("keeps the words worth matching in a title", () => {
    expect(searchText("the Entra ID sign-in story")).toBe("entra id sign");
    expect(searchText("#1024")).toBe("1024");
    expect(searchText("story")).toBe("story");
  });
});
