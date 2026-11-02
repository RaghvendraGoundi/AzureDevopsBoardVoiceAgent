import { describe, expect, it } from "vitest";
import { AliasBook, redactForModel, unaliasArgs, unaliasText } from "./redact";

describe("email redaction", () => {
  it("replaces every email in nested tool output with a stable alias", () => {
    const book = new AliasBook();
    const output = {
      ok: true,
      items: [{ assigned_to: "svc-build@contoso.com" }, { assigned_to: "Priya Shah" }],
      comments: [{ text: "Ping Priya.Shah@contoso.com or svc-build@contoso.com" }],
    };
    const { value, aliases } = redactForModel(output, book);
    expect(JSON.stringify(value)).not.toMatch(/@contoso\.com/);
    expect(value.items[0].assigned_to).toBe("person-1@redacted.invalid");
    expect(value.comments[0].text).toBe("Ping person-2@redacted.invalid or person-1@redacted.invalid");
    expect(aliases).toEqual({ "person-1@redacted.invalid": "svc-build@contoso.com", "person-2@redacted.invalid": "Priya.Shah@contoso.com" });
    expect(output.items[0].assigned_to).toBe("svc-build@contoso.com"); // the original (UI) copy is untouched
  });

  it("turns aliases the model sends back into the real address", () => {
    const book = new AliasBook();
    redactForModel({ who: "jordan.lee@contoso.com" }, book);
    expect(unaliasArgs({ id: 7, assignee: "person-1@redacted.invalid" }, book)).toEqual({ id: 7, assignee: "jordan.lee@contoso.com" });
    expect(unaliasArgs({ assignee: "person-99@redacted.invalid" }, book)).toEqual({ assignee: "person-99@redacted.invalid" });
  });

  it("shows the real address in what the assistant said", () => {
    expect(unaliasText("Assigned to person-1@redacted.invalid.", { "person-1@redacted.invalid": "svc@contoso.com" })).toBe("Assigned to svc@contoso.com.");
    expect(unaliasText("person-5@redacted.invalid", {})).toBe("someone");
  });
});
