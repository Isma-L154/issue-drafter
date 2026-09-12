import { describe, expect, it } from "vitest";
import { SYSTEM_PROMPT, buildMessages } from "../src/prompt.ts";
import type { IssueFields } from "../src/schema.ts";

const previous: IssueFields = {
  type: "bug", title: "Bot hangs", summary: "s", steps: [], expected: "e", actual: "a",
  impact: "", acceptance: ["c"], openQuestions: [],
};

describe("buildMessages", () => {
  it("sends the system prompt and the note with the requested type", () => {
    const [system, user] = buildMessages({ note: "el bot se traba", type: "auto" });
    expect(system).toEqual({ role: "system", content: SYSTEM_PROMPT });
    expect(user?.role).toBe("user");
    expect(user?.content).toContain("Requested type: auto");
    expect(user?.content).toContain('Note:\n"""\nel bot se traba\n"""');
    expect(user?.content).not.toContain("/no_think");
  });

  it("includes the current draft and the correction when correcting", () => {
    const [, user] = buildMessages({ note: "n", type: "bug", previous, correction: "quita la parte de discord" });
    expect(user?.content).toContain(`Current draft:\n${JSON.stringify(previous)}`);
    expect(user?.content).toContain('Correction from the author:\n"""\nquita la parte de discord\n"""');
    expect(user?.content).toContain("Apply the correction");
  });

  it("ignores a correction without a previous draft", () => {
    const [, user] = buildMessages({ note: "n", type: "bug", correction: "c" });
    expect(user?.content).not.toContain("Correction from the author");
  });

  it("lists the problems of a rejected answer", () => {
    const [, user] = buildMessages({ note: "n", type: "task" }, ["scope must contain at least one item."]);
    expect(user?.content).toContain("Your previous answer was rejected:\n- scope must contain at least one item.");
  });

  it("describes all three shapes and forbids invented facts", () => {
    for (const shape of ['"type":"bug"', '"type":"feature"', '"type":"task"', "Never invent facts"]) {
      expect(SYSTEM_PROMPT).toContain(shape);
    }
  });
});
