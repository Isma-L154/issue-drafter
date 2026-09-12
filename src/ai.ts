import { buildMessages, type ChatMessage, type DraftInput } from "./prompt.ts";
import { validateFields, type IssueFields } from "./schema.ts";

export interface TextModel {
  run(model: string, input: { messages: ChatMessage[]; max_tokens: number; temperature: number }): Promise<unknown>;
}

export type DraftErrorKind = "invalid_output" | "quota_exhausted" | "unavailable";

// No constructor parameter properties: `scripts/eval.ts` imports this module
// under Node's type stripping, which rejects syntax that needs transforming.
export class DraftError extends Error {
  readonly kind: DraftErrorKind;

  constructor(kind: DraftErrorKind, message: string) {
    super(message);
    this.name = "DraftError";
    this.kind = kind;
  }
}

// Room for the reasoning that precedes the JSON. Neurons are billed on tokens
// actually produced, so a generous cap costs nothing when unused.
const MAX_TOKENS = 3000;

// Low, because the task is transcription rather than invention: at the model's
// default the same note gained or lost made-up sections from one run to the next.
const TEMPERATURE = 0.2;

const isObject = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

function outputText(output: Record<string, unknown>): string | undefined {
  const choices = output["choices"];
  if (Array.isArray(choices) && isObject(choices[0]) && isObject(choices[0]["message"])) {
    const content = choices[0]["message"]["content"];
    if (typeof content === "string") return content;
  }
  return typeof output["response"] === "string" ? output["response"] : undefined;
}

export function extractJson(output: unknown): unknown {
  if (!isObject(output)) return undefined;
  if (isObject(output["response"])) return output["response"];

  const text = outputText(output)?.replace(/<think>[\s\S]*?<\/think>/g, "");
  if (text === undefined) return undefined;
  const start = text.indexOf("{");
  const end = text.lastIndexOf("}");
  if (start === -1 || end <= start) return undefined;
  try {
    return JSON.parse(text.slice(start, end + 1));
  } catch {
    return undefined;
  }
}

async function callModel(ai: TextModel, model: string, messages: ChatMessage[]): Promise<unknown> {
  try {
    return await ai.run(model, { messages, max_tokens: MAX_TOKENS, temperature: TEMPERATURE });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (message.includes("4006") || /daily free allocation/i.test(message)) {
      throw new DraftError("quota_exhausted", "The daily Workers AI allocation is used up. It resets at 00:00 UTC.");
    }
    throw new DraftError("unavailable", "The model is unavailable right now. Try again in a moment.");
  }
}

export async function draftIssue(ai: TextModel, model: string, input: DraftInput): Promise<IssueFields> {
  let problems: string[] = [];
  for (let attempt = 0; attempt < 2; attempt++) {
    const output = await callModel(ai, model, buildMessages(input, problems));
    const result = validateFields(extractJson(output), input.type);
    if (result.ok) return result.fields;
    problems = result.problems;
  }
  throw new DraftError("invalid_output", "The model did not return a usable draft. Try again or rephrase the note.");
}
