import { describe, expect, it } from "vitest";
import { pickVoice } from "./voices";

describe("pickVoice", () => {
  it("uses the user's pick when the engine has that voice", () => {
    expect(pickVoice("live", "willow", "marin")).toBe("willow");
    expect(pickVoice("realtime", "coral", undefined)).toBe("coral");
  });

  it("falls back to the configured default for unknown or other-engine voices", () => {
    expect(pickVoice("realtime", "willow", "cedar")).toBe("cedar");
    expect(pickVoice("live", 42, undefined)).toBe("marin");
  });
});
