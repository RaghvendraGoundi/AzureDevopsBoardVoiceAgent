import { afterEach, describe, expect, it, vi } from "vitest";
import type { ToolResponse } from "@/types/voice";
import { RunningTools, statusNote } from "./toolRun";

afterEach(() => vi.useRealTimers());

const never = () => new Promise<ToolResponse>(() => undefined);

describe("RunningTools", () => {
  it("ends a call that never answers with a timeout the model can explain", async () => {
    vi.useFakeTimers();
    const tools = new RunningTools(1000, () => Date.now());
    const result = tools.run("c1", "list_work_items", never);
    expect(tools.busy).toBe(true);
    await vi.advanceTimersByTimeAsync(1001);
    expect((await result).output).toMatchObject({ ok: false, code: "timeout", error: expect.stringMatching(/Nothing was changed/) });
    expect(tools.busy).toBe(false);
  });

  it("warns that a timed-out confirmation may or may not have been saved", async () => {
    vi.useFakeTimers();
    const tools = new RunningTools(1000, () => Date.now());
    const result = tools.run("c1", "confirm_action", never);
    await vi.advanceTimersByTimeAsync(1001);
    expect(String((await result).output.error)).toMatch(/can't tell whether the change was saved/);
  });

  it("stops waiting on request, and reports what's been running longest", async () => {
    let now = 0;
    const tools = new RunningTools(60_000, () => now);
    const a = tools.run("c1", "list_work_items", never);
    now = 3000;
    void tools.run("c2", "get_work_item", never);
    now = 5000;
    expect(tools.longest()).toEqual({ name: "list_work_items", ms: 5000 });
    tools.cancelAll();
    expect((await a).output).toMatchObject({ ok: false, code: "cancelled" });
    expect(tools.longest()).toBeNull();
  });

  it("turns a failed request into a tool error instead of throwing", async () => {
    const tools = new RunningTools();
    const r = await tools.run("c1", "list_work_items", () => Promise.reject(new Error("offline")));
    expect(r.output).toMatchObject({ ok: false });
  });
});

describe("statusNote", () => {
  it("tells the assistant what's running and how to answer", () => {
    const note = statusNote({ name: "list_work_items", ms: 6400 }, true);
    expect(note).toMatch(/searching azure devops, 6 s so far/);
    expect(note).toMatch(/still working on the earlier request/);
    expect(note).toMatch(/Don't call any tools/);
  });
});
