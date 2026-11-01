import { describe, expect, it, vi } from "vitest";
import { CachedBoard, TtlCache } from "./cache";
import { EmulatedBoard, memoryStorage } from "./emulatedBoard";

describe("TtlCache", () => {
  it("shares one load between callers and expires it", async () => {
    let now = 0;
    const cache = new TtlCache(() => now);
    const load = vi.fn(async () => "value");
    await Promise.all([cache.get("k", 100, load), cache.get("k", 100, load)]);
    expect(load).toHaveBeenCalledOnce();
    now = 101;
    await cache.get("k", 100, load);
    expect(load).toHaveBeenCalledTimes(2);
  });

  it("never caches a failure", async () => {
    const cache = new TtlCache();
    await expect(cache.get("k", 1000, async () => Promise.reject(new Error("down")))).rejects.toThrow("down");
    await expect(cache.get("k", 1000, async () => "up")).resolves.toBe("up");
  });
});

describe("CachedBoard", () => {
  it("serves repeat reads from cache and drops them after a write", async () => {
    const inner = new EmulatedBoard(memoryStorage(), "Test User", () => new Date("2026-10-31T12:00:00Z"));
    const query = vi.spyOn(inner, "query");
    const board = new CachedBoard(inner, new TtlCache(), "u:");
    await board.query({ text: "authentication" });
    await board.query({ text: "authentication" });
    expect(query).toHaveBeenCalledOnce();

    await board.update(1024, { comment: "cache test" });
    await board.query({ text: "authentication" });
    expect(query).toHaveBeenCalledTimes(2);
  });
});
