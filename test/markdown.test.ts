import { describe, expect, it } from "vitest";
import { parseMarkdown, splitInline } from "../public/markdown.js";
import { renderIssue } from "../src/render.ts";

describe("splitInline", () => {
  it("marks the text between backticks as code", () => {
    expect(splitInline("run `npm test` now")).toEqual([
      { code: false, text: "run " },
      { code: true, text: "npm test" },
      { code: false, text: " now" },
    ]);
  });

  it("drops the empty parts around a code span", () => {
    expect(splitInline("`npm test`")).toEqual([{ code: true, text: "npm test" }]);
  });
});

describe("parseMarkdown", () => {
  it("reads every kind of section the templates render", () => {
    const { body } = renderIssue({
      type: "bug", title: "Bot hangs", summary: "It hangs on `play`.", steps: ["Open it", "Press play"],
      expected: "It plays.", actual: "It hangs.", impact: "", acceptance: ["It plays"], openQuestions: ["Since when?"],
    });
    expect(parseMarkdown(body)).toEqual([
      { kind: "heading", text: "Summary" },
      { kind: "paragraph", text: "It hangs on `play`." },
      { kind: "heading", text: "Steps to reproduce" },
      { kind: "list", ordered: true, items: [{ checked: null, text: "Open it" }, { checked: null, text: "Press play" }] },
      { kind: "heading", text: "Expected behavior" },
      { kind: "paragraph", text: "It plays." },
      { kind: "heading", text: "Actual behavior" },
      { kind: "paragraph", text: "It hangs." },
      { kind: "heading", text: "Acceptance criteria" },
      { kind: "list", ordered: false, items: [{ checked: false, text: "It plays" }] },
      { kind: "heading", text: "Open questions" },
      { kind: "list", ordered: false, items: [{ checked: null, text: "Since when?" }] },
    ]);
  });

  it("joins consecutive lines into one paragraph and splits on blank lines", () => {
    expect(parseMarkdown("one\ntwo\n\nthree")).toEqual([
      { kind: "paragraph", text: "one two" },
      { kind: "paragraph", text: "three" },
    ]);
  });

  it("starts a new list when bullets turn into numbers", () => {
    expect(parseMarkdown("- a\n1. b")).toEqual([
      { kind: "list", ordered: false, items: [{ checked: null, text: "a" }] },
      { kind: "list", ordered: true, items: [{ checked: null, text: "b" }] },
    ]);
  });

  it("reads a checked box in either case", () => {
    expect(parseMarkdown("- [x] done\n* [X] also")).toEqual([
      { kind: "list", ordered: false, items: [{ checked: true, text: "done" }, { checked: true, text: "also" }] },
    ]);
  });

  it("finds nothing in a blank body", () => {
    expect(parseMarkdown("  \n\n")).toEqual([]);
  });
});
