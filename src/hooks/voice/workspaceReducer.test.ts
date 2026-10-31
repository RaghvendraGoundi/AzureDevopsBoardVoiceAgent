import { describe, expect, it } from "vitest";
import { buildSeed } from "@/lib/devops/seed";
import type { WorkItem } from "@/lib/devops/types";
import type { PendingAction } from "@/types/voice";
import { initialWorkspaceState, workspaceReducer, type WorkspaceAction, type WorkspaceState } from "./workspaceReducer";

const items: WorkItem[] = buildSeed("Me")
  .slice(0, 3)
  .map((i) => ({ ...i, stateCategory: "InProgress", sprintName: "Sprint 42", parentTitle: null, url: null }));
const apply = (actions: WorkspaceAction[], from: WorkspaceState = initialWorkspaceState) =>
  actions.reduce(workspaceReducer, from);

describe("workspaceReducer", () => {
  it("streams transcript deltas and replaces them with the final text", () => {
    const s = apply([
      { type: "user_transcript", id: "u1", text: "", final: false },
      { type: "assistant_transcript", id: "a1", text: "You ", final: false },
      { type: "assistant_transcript", id: "a1", text: "have", final: false },
      { type: "user_transcript", id: "u1", text: "Show my tasks", final: true },
      { type: "assistant_transcript", id: "a1", text: "You have three.", final: true },
    ]);
    expect(s.transcript.map((e) => [e.role, e.text])).toEqual([
      ["user", "Show my tasks"],
      ["assistant", "You have three."],
    ]);
  });

  it("drops empty user turns (noise)", () => {
    const s = apply([
      { type: "user_transcript", id: "u1", text: "", final: false },
      { type: "user_transcript", id: "u1", text: "  ", final: true },
    ]);
    expect(s.transcript).toEqual([]);
  });

  it("marks a cut-off assistant reply as interrupted and drops empty ones", () => {
    const s = apply([
      { type: "assistant_transcript", id: "a1", text: "You have five active", final: false },
      { type: "assistant_transcript", id: "a2", text: "", final: false },
      { type: "assistant_interrupted" },
    ]);
    expect(s.transcript).toEqual([{ id: "a1", role: "assistant", text: "You have five active", final: true, interrupted: true }]);
  });

  it("tracks the active tool label", () => {
    const s = apply([{ type: "tool_started", callId: "c", tool: "list_work_items", args: {} }]);
    expect(s.activeTool).toBe("Searching Azure DevOps…");
    expect(apply([{ type: "tool_finished", callId: "c", tool: "list_work_items", ok: true }], s).activeTool).toBeNull();
  });

  it("applies updates in place, clears the pending action and logs activity", () => {
    const before = items[1];
    const after: WorkItem = { ...before, state: "Closed", stateCategory: "Completed", rev: before.rev + 1 };
    const pending: PendingAction = { actionId: "act_1", kind: "update", message: "", before, after, expiresAt: "" };
    const s = apply([
      { type: "work_items_loaded", title: "Yours", items },
      { type: "work_item_preview", action: pending },
      { type: "confirmation_resolved", actionId: "act_1", outcome: "confirmed" },
      { type: "work_item_updated", item: after, before },
    ]);
    expect(s.pending).toBeNull();
    expect(s.results?.items[1].state).toBe("Closed");
    expect(s.focusedId).toBe(before.id);
    expect(s.activity[0]).toMatchObject({ kind: "updated" });
    expect(s.flash[before.id]).toBe("updated");
  });

  it("ignores resolutions for a different pending action", () => {
    const pending: PendingAction = { actionId: "act_new", kind: "create", message: "", after: items[0], expiresAt: "" };
    const s = apply([
      { type: "work_item_preview", action: pending },
      { type: "confirmation_resolved", actionId: "act_old", outcome: "cancelled" },
    ]);
    expect(s.pending?.actionId).toBe("act_new");
  });

  it("prepends created items and keeps at most three errors", () => {
    const created = { ...items[0], id: 2000, title: "New one" };
    const s = apply([
      { type: "work_items_loaded", title: "Yours", items },
      { type: "work_item_created", item: created },
      ...[1, 2, 3, 4].map((n) => ({ type: "error" as const, message: `e${n}` })),
    ]);
    expect(s.results?.items[0].id).toBe(2000);
    expect(s.errors.map((e) => e.message)).toEqual(["e2", "e3", "e4"]);
  });

  it("keeps the board header across a reset", () => {
    const info = { provider: "emulated" as const, project: "Contoso", team: "Contoso Team", user: "Me", sprint: null };
    const s = apply([{ type: "board_info", info }, { type: "reset" }]);
    expect(s.boardInfo).toEqual(info);
  });
});
