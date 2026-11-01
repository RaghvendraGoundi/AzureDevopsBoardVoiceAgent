import { describe, expect, it } from "vitest";
import { ACTION_TTL_MS, PendingActionStore } from "./pendingActions";

const op = { kind: "update" as const, id: 1, rev: 1, changes: { state: "Closed" } };

describe("PendingActionStore", () => {
  it("hands an action out once, to the user who proposed it", () => {
    const store = new PendingActionStore(() => 0);
    const { actionId } = store.add(op, "alice");
    expect(store.take(actionId, "bob")).toEqual({ ok: false, reason: "unknown" });
    expect(store.take(actionId, "alice")).toEqual({ ok: true, op });
    expect(store.take(actionId, "alice")).toEqual({ ok: false, reason: "unknown" });
  });

  it("expires actions that weren't confirmed in time", () => {
    let now = 0;
    const store = new PendingActionStore(() => now);
    const { actionId } = store.add(op, "alice");
    now = ACTION_TTL_MS + 1;
    expect(store.take(actionId, "alice")).toEqual({ ok: false, reason: "expired" });
  });
});
