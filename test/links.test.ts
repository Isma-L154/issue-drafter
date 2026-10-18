import { describe, expect, it } from "vitest";
import { findUrls, linkProblems } from "../src/links.ts";
import type { FeatureFields } from "../src/schema.ts";

const URL = "https://example.com/checkout?step=2&ref=abc";

const feature = (overrides: Partial<FeatureFields> = {}): FeatureFields => ({
  type: "feature", title: "Fix the checkout button", goal: `The button works on the [checkout page](${URL}).`,
  context: "", proposed: "p", acceptance: ["c"], outOfScope: [], openQuestions: [], ...overrides,
});

describe("findUrls", () => {
  it("finds http and https URLs with their query strings", () => {
    expect(findUrls(`see ${URL} and http://a.dev/x`)).toEqual([URL, "http://a.dev/x"]);
  });

  it("leaves out sentence punctuation after a URL", () => {
    expect(findUrls("it fails on https://a.dev/x.")).toEqual(["https://a.dev/x"]);
  });

  it("ends a URL where its Markdown link or parentheses close", () => {
    expect(findUrls(`[page](${URL}) (https://a.dev/x)`)).toEqual([URL, "https://a.dev/x"]);
  });
});

describe("linkProblems", () => {
  it("accepts every note URL written as a descriptive link", () => {
    expect(linkProblems(feature(), { note: `falla en ${URL}`, type: "auto" })).toEqual([]);
  });

  it("rejects a URL the note does not contain", () => {
    expect(linkProblems(feature({ context: "See the [docs](https://a.dev/docs)." }), { note: `falla en ${URL}`, type: "auto" }))
      .toEqual(["https://a.dev/docs is not in the note. Use only URLs the note contains, copied exactly."]);
  });

  it("rejects an altered URL and reports the note's URL as missing", () => {
    const fields = feature({ goal: "It works on the [checkout page](https://example.com/checkout)." });
    expect(linkProblems(fields, { note: `falla en ${URL}`, type: "auto" })).toEqual([
      "https://example.com/checkout is not in the note. Use only URLs the note contains, copied exactly.",
      `${URL} from the note is missing. Include it as a Markdown link.`,
    ]);
  });

  it("rejects a bare URL", () => {
    expect(linkProblems(feature({ goal: `The button works on ${URL}.` }), { note: `falla en ${URL}`, type: "auto" }))
      .toEqual([`Write ${URL} as a Markdown link: [short descriptive text](${URL}).`]);
  });

  it("rejects a URL in the title", () => {
    expect(linkProblems(feature({ title: `Fix ${URL}` }), { note: `falla en ${URL}`, type: "auto" }))
      .toEqual(["title must not contain URLs."]);
  });

  it("checks list items too", () => {
    expect(linkProblems(feature({ goal: "g", acceptance: [`The [checkout page](${URL}) works`] }), { note: `falla en ${URL}`, type: "auto" }))
      .toEqual([]);
  });

  it("lets a correction add a URL or drop one from the note", () => {
    const previous = feature();
    const added = feature({ context: "See the [docs](https://a.dev/docs)." });
    expect(linkProblems(added, { note: `falla en ${URL}`, type: "auto", previous, correction: "agrega https://a.dev/docs" })).toEqual([]);
    const dropped = feature({ goal: "The button works." });
    expect(linkProblems(dropped, { note: `falla en ${URL}`, type: "auto", previous, correction: "quita el link" })).toEqual([]);
  });
});
