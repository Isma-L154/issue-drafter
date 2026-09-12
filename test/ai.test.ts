import { describe, expect, it } from "vitest";
import { DraftError, draftIssue, extractJson, type TextModel } from "../src/ai.ts";
import type { ChatMessage } from "../src/prompt.ts";

const valid = {
  type: "bug", title: "Bot hangs", summary: "s", steps: [], expected: "e", actual: "a",
  impact: "", acceptance: ["c"], openQuestions: [],
};

function fakeModel(outputs: Array<unknown | Error>) {
  const calls: ChatMessage[][] = [];
  const model: TextModel = {
    async run(_model, input) {
      calls.push(input.messages);
      const next = outputs.shift();
      if (next instanceof Error) throw next;
      return next;
    },
  };
  return { model, calls };
}

const asContent = (text: string) => ({ choices: [{ message: { content: text } }] });

describe("extractJson", () => {
  it("prefers an already parsed response object", () => {
    expect(extractJson({ response: valid, choices: [{ message: { content: "garbage" } }] })).toEqual(valid);
  });

  it("parses content with leading blank lines, think tags or a code fence", () => {
    expect(extractJson(asContent(`\n\n${JSON.stringify(valid)}`))).toEqual(valid);
    expect(extractJson(asContent(`<think>hmm</think>${JSON.stringify(valid)}`))).toEqual(valid);
    expect(extractJson(asContent("```json\n" + JSON.stringify(valid) + "\n```"))).toEqual(valid);
  });

  it("parses a string response", () => {
    expect(extractJson({ response: JSON.stringify(valid) })).toEqual(valid);
  });

  it("returns undefined when nothing parses", () => {
    expect(extractJson(asContent("no json here"))).toBeUndefined();
    expect(extractJson(null)).toBeUndefined();
  });
});

describe("draftIssue", () => {
  it("returns validated fields from the first good answer", async () => {
    const { model, calls } = fakeModel([asContent(JSON.stringify(valid))]);
    const fields = await draftIssue(model, "m", { note: "n", type: "auto" });
    expect(fields.title).toBe("Bot hangs");
    expect(calls).toHaveLength(1);
  });

  it("retries once, telling the model what was wrong", async () => {
    const { model, calls } = fakeModel([asContent(JSON.stringify({ ...valid, acceptance: [] })), asContent(JSON.stringify(valid))]);
    await draftIssue(model, "m", { note: "n", type: "auto" });
    expect(calls).toHaveLength(2);
    expect(calls[1]?.[1]?.content).toContain("- acceptance must contain at least one item.");
  });

  it("gives up after the retry", async () => {
    const { model, calls } = fakeModel([asContent("nope"), asContent("still nope")]);
    await expect(draftIssue(model, "m", { note: "n", type: "auto" })).rejects.toMatchObject({ kind: "invalid_output" });
    expect(calls).toHaveLength(2);
  });

  it("reports an exhausted allocation distinctly", async () => {
    const { model } = fakeModel([new Error("AiError: 4006: you have used up your daily free allocation of 10,000 neurons")]);
    const error = await draftIssue(model, "m", { note: "n", type: "auto" }).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(DraftError);
    expect(error).toMatchObject({ kind: "quota_exhausted" });
  });

  it("reports any other model failure as unavailable", async () => {
    const { model } = fakeModel([new Error("InferenceUpstreamError: 3040")]);
    await expect(draftIssue(model, "m", { note: "n", type: "auto" })).rejects.toMatchObject({ kind: "unavailable" });
  });
});
