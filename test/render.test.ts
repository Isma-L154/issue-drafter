import { describe, expect, it } from "vitest";
import { renderIssue } from "../src/render.ts";

describe("renderIssue", () => {
  it("renders a bug and omits empty optional sections", () => {
    const issue = renderIssue({
      type: "bug",
      title: "Bot hangs when loading long playlists",
      summary: "Adding a 300-song playlist freezes the bot.",
      steps: [],
      expected: "Playback starts right away.",
      actual: "The bot stops responding.",
      impact: "",
      acceptance: ["Playback starts early", "The bot stays connected"],
      openQuestions: ["Which command was used?"],
    });
    expect(issue.title).toBe("Bot hangs when loading long playlists");
    expect(issue.labels).toEqual(["bug"]);
    expect(issue.body).toBe(
      [
        "## Summary\n\nAdding a 300-song playlist freezes the bot.",
        "## Expected behavior\n\nPlayback starts right away.",
        "## Actual behavior\n\nThe bot stops responding.",
        "## Acceptance criteria\n\n- [ ] Playback starts early\n- [ ] The bot stays connected",
        "## Open questions\n\n- Which command was used?",
      ].join("\n\n") + "\n",
    );
  });

  it("numbers reproduction steps and includes impact when present", () => {
    const { body } = renderIssue({
      type: "bug", title: "t", summary: "s", steps: ["One", "Two"], expected: "e", actual: "a",
      impact: "Every long playlist.", acceptance: ["c"], openQuestions: [],
    });
    expect(body).toContain("## Steps to reproduce\n\n1. One\n2. Two");
    expect(body).toContain("## Impact\n\nEvery long playlist.");
    expect(body).not.toContain("## Open questions");
  });

  it("renders a feature with the enhancement label", () => {
    const issue = renderIssue({
      type: "feature", title: "Load playlists progressively", goal: "Start fast.", context: "Long playlists freeze the bot.",
      proposed: "Queue the first tracks first.", acceptance: ["Starts early"], outOfScope: ["Spotify"], openQuestions: [],
    });
    expect(issue.labels).toEqual(["enhancement"]);
    expect(issue.body).toBe(
      [
        "## Goal\n\nStart fast.",
        "## Context\n\nLong playlists freeze the bot.",
        "## Proposed behavior\n\nQueue the first tracks first.",
        "## Acceptance criteria\n\n- [ ] Starts early",
        "## Out of scope\n\n- Spotify",
      ].join("\n\n") + "\n",
    );
  });

  it("renders a task with scope as a checklist", () => {
    const issue = renderIssue({
      type: "task", title: "Remove dead code", goal: "Less code.", context: "", scope: ["src/", "test/"],
      acceptance: ["Suite passes"], outOfScope: [], openQuestions: ["Keep the old CLI?"],
    });
    expect(issue.labels).toEqual(["task"]);
    expect(issue.body).toBe(
      [
        "## Goal\n\nLess code.",
        "## Scope\n\n- [ ] src/\n- [ ] test/",
        "## Acceptance criteria\n\n- [ ] Suite passes",
        "## Open questions\n\n- Keep the old CLI?",
      ].join("\n\n") + "\n",
    );
  });
});
