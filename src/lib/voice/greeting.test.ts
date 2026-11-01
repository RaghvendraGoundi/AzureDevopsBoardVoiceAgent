import { describe, expect, it } from "vitest";
import { greetingInstruction } from "./greeting";

const info = {
  provider: "azure" as const,
  project: "MyWork",
  team: "MyWork Team",
  user: "Alex Morgan",
  sprint: { name: "Sprint 3", finishDate: null, daysLeft: 11 },
};

describe("greetingInstruction", () => {
  it("greets by first name for the time of day, with the sprint as an optional touch", () => {
    const text = greetingInstruction(info, false, new Date("2026-11-01T14:00:00"));
    expect(text).toMatch(/afternoon/);
    expect(text).toMatch(/Alex/);
    expect(text).not.toMatch(/Alex Morgan/);
    expect(text).toMatch(/Sprint 3 has 11 days left/);
    expect(text).toMatch(/Don't call any tools/);
  });

  it("welcomes the user back to a reopened conversation", () => {
    expect(greetingInstruction(info, true)).toMatch(/welcome the user, Alex back/i);
  });

  it("still works before the board has answered", () => {
    expect(greetingInstruction(null, false, new Date("2026-11-01T08:00:00"))).toMatch(/morning.*Greet the user warmly/);
  });
});
