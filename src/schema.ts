export const ISSUE_TYPES = ["bug", "feature", "task"] as const;
export type IssueType = (typeof ISSUE_TYPES)[number];
export type RequestedType = IssueType | "auto";

interface CommonFields {
  title: string;
  acceptance: string[];
  openQuestions: string[];
}

export interface BugFields extends CommonFields {
  type: "bug";
  summary: string;
  steps: string[];
  expected: string;
  actual: string;
  impact: string;
}

export interface FeatureFields extends CommonFields {
  type: "feature";
  goal: string;
  context: string;
  proposed: string;
  outOfScope: string[];
}

export interface TaskFields extends CommonFields {
  type: "task";
  goal: string;
  context: string;
  scope: string[];
  outOfScope: string[];
}

export type IssueFields = BugFields | FeatureFields | TaskFields;

export type Validation = { ok: true; fields: IssueFields } | { ok: false; problems: string[] };

const MAX_TITLE = 120;
const MAX_TEXT = 4000;
const MAX_ITEMS = 20;

export function isRequestedType(value: unknown): value is RequestedType {
  return value === "auto" || (ISSUE_TYPES as readonly unknown[]).includes(value);
}

export function validateFields(raw: unknown, requested: RequestedType): Validation {
  if (typeof raw !== "object" || raw === null || Array.isArray(raw)) {
    return { ok: false, problems: ["The answer must be a JSON object."] };
  }
  const source = raw as Record<string, unknown>;
  const type = source["type"];
  if (!(ISSUE_TYPES as readonly unknown[]).includes(type)) {
    return { ok: false, problems: ['type must be one of "bug", "feature", "task".'] };
  }

  const problems: string[] = [];
  if (requested !== "auto" && type !== requested) {
    problems.push(`type must be "${requested}".`);
  }

  const text = (key: string, required = false): string => {
    const value = source[key];
    const trimmed = typeof value === "string" ? value.trim() : "";
    if (required && trimmed === "") problems.push(`${key} is required.`);
    const max = key === "title" ? MAX_TITLE : MAX_TEXT;
    if (trimmed.length > max) problems.push(`${key} must be at most ${max} characters.`);
    return trimmed;
  };

  const list = (key: string, required = false): string[] => {
    const value = source[key];
    const items = Array.isArray(value)
      ? value.filter((item): item is string => typeof item === "string").map((item) => item.trim()).filter((item) => item !== "")
      : [];
    if (required && items.length === 0) problems.push(`${key} must contain at least one item.`);
    if (items.some((item) => item.length > MAX_TEXT)) problems.push(`${key} items must be at most ${MAX_TEXT} characters.`);
    return items.slice(0, MAX_ITEMS);
  };

  // Call order below is the order of `problems`, which is fed back to the model.
  let fields: IssueFields;
  const title = text("title", true);
  if (type === "bug") {
    const summary = text("summary", true);
    const steps = list("steps");
    const expected = text("expected", true);
    const actual = text("actual", true);
    const impact = text("impact");
    fields = { type, title, summary, steps, expected, actual, impact, acceptance: list("acceptance", true), openQuestions: list("openQuestions") };
  } else if (type === "feature") {
    const goal = text("goal", true);
    const context = text("context");
    const proposed = text("proposed", true);
    fields = { type, title, goal, context, proposed, acceptance: list("acceptance", true), outOfScope: list("outOfScope"), openQuestions: list("openQuestions") };
  } else {
    const goal = text("goal", true);
    const context = text("context");
    const scope = list("scope", true);
    fields = { type: "task", title, goal, context, scope, acceptance: list("acceptance", true), outOfScope: list("outOfScope"), openQuestions: list("openQuestions") };
  }

  return problems.length > 0 ? { ok: false, problems } : { ok: true, fields };
}
