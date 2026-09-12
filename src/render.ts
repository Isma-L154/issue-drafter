import type { IssueFields, IssueType } from "./schema.ts";

export interface RenderedIssue {
  title: string;
  body: string;
  labels: string[];
}

export const LABELS: Record<IssueType, string> = { bug: "bug", feature: "enhancement", task: "task" };

type Section = [heading: string, content: string];

const numbered = (items: string[]) => items.map((item, i) => `${i + 1}. ${item}`).join("\n");
const checklist = (items: string[]) => items.map((item) => `- [ ] ${item}`).join("\n");
const bullets = (items: string[]) => items.map((item) => `- ${item}`).join("\n");

function sectionsFor(fields: IssueFields): Section[] {
  switch (fields.type) {
    case "bug":
      return [
        ["Summary", fields.summary],
        ["Steps to reproduce", numbered(fields.steps)],
        ["Expected behavior", fields.expected],
        ["Actual behavior", fields.actual],
        ["Impact", fields.impact],
        ["Acceptance criteria", checklist(fields.acceptance)],
        ["Open questions", bullets(fields.openQuestions)],
      ];
    case "feature":
      return [
        ["Goal", fields.goal],
        ["Context", fields.context],
        ["Proposed behavior", fields.proposed],
        ["Acceptance criteria", checklist(fields.acceptance)],
        ["Out of scope", bullets(fields.outOfScope)],
        ["Open questions", bullets(fields.openQuestions)],
      ];
    case "task":
      return [
        ["Goal", fields.goal],
        ["Context", fields.context],
        ["Scope", checklist(fields.scope)],
        ["Acceptance criteria", checklist(fields.acceptance)],
        ["Out of scope", bullets(fields.outOfScope)],
        ["Open questions", bullets(fields.openQuestions)],
      ];
  }
}

export function renderIssue(fields: IssueFields): RenderedIssue {
  const body = sectionsFor(fields)
    .filter(([, content]) => content !== "")
    .map(([heading, content]) => `## ${heading}\n\n${content}`)
    .join("\n\n");
  return { title: fields.title, body: `${body}\n`, labels: [LABELS[fields.type]] };
}
