import { describe, expect, it } from "vitest";
import { isRequestedType, validateFields } from "../src/schema.ts";

const bug = {
  type: "bug",
  title: "  Bot hangs when loading long playlists ",
  summary: "Adding a 300-song playlist freezes the bot.",
  steps: ["Add a 300-song playlist", "  ", 7],
  expected: "Playback starts right away.",
  actual: "The bot stops responding for a minute.",
  acceptance: ["Playback starts before the playlist is fully loaded"],
  openQuestions: ["Which command was used?"],
  extra: "discarded",
};

describe("validateFields", () => {
  it("normalizes a valid bug and drops unknown keys and empty items", () => {
    const result = validateFields(bug, "auto");
    expect(result).toEqual({
      ok: true,
      fields: {
        type: "bug",
        title: "Bot hangs when loading long playlists",
        summary: "Adding a 300-song playlist freezes the bot.",
        steps: ["Add a 300-song playlist"],
        expected: "Playback starts right away.",
        actual: "The bot stops responding for a minute.",
        impact: "",
        acceptance: ["Playback starts before the playlist is fully loaded"],
        openQuestions: ["Which command was used?"],
      },
    });
  });

  it("accepts a feature with only its required fields", () => {
    const result = validateFields(
      { type: "feature", title: "Load playlists progressively", goal: "Start fast.", proposed: "Queue the first tracks first.", acceptance: ["Starts in under 5 s"] },
      "feature",
    );
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.fields).toEqual({
        type: "feature",
        title: "Load playlists progressively",
        goal: "Start fast.",
        context: "",
        proposed: "Queue the first tracks first.",
        acceptance: ["Starts in under 5 s"],
        outOfScope: [],
        openQuestions: [],
      });
    }
  });

  it("requires a scope item for a task", () => {
    const result = validateFields({ type: "task", title: "Clean up", goal: "Remove dead code.", acceptance: ["Suite passes"] }, "task");
    expect(result).toEqual({ ok: false, problems: ["scope must contain at least one item."] });
  });

  it("rejects a type other than the requested one", () => {
    const result = validateFields(bug, "feature");
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.problems).toContain('type must be "feature".');
  });

  it("reports every missing required field at once", () => {
    const result = validateFields({ type: "bug", title: "" }, "auto");
    expect(result).toEqual({
      ok: false,
      problems: [
        "title is required.",
        "summary is required.",
        "expected is required.",
        "actual is required.",
        "acceptance must contain at least one item.",
      ],
    });
  });

  it("rejects non-objects and unknown types", () => {
    expect(validateFields("text", "auto")).toEqual({ ok: false, problems: ["The answer must be a JSON object."] });
    expect(validateFields([], "auto")).toEqual({ ok: false, problems: ["The answer must be a JSON object."] });
    expect(validateFields({ type: "epic" }, "auto")).toEqual({ ok: false, problems: ['type must be one of "bug", "feature", "task".'] });
  });

  it("bounds title and string length", () => {
    const long = validateFields({ ...bug, title: "x".repeat(121), summary: "y".repeat(4001) }, "auto");
    expect(long).toEqual({
      ok: false,
      problems: ["title must be at most 120 characters.", "summary must be at most 4000 characters."],
    });
  });

  it("keeps at most 20 list items", () => {
    const result = validateFields({ ...bug, acceptance: Array.from({ length: 30 }, (_, i) => `c${i}`) }, "auto");
    expect(result.ok && result.fields.acceptance.length).toBe(20);
  });
});

describe("isRequestedType", () => {
  it("accepts the three types and auto only", () => {
    expect(["auto", "bug", "feature", "task"].every(isRequestedType)).toBe(true);
    expect(isRequestedType("epic")).toBe(false);
    expect(isRequestedType(undefined)).toBe(false);
  });
});
