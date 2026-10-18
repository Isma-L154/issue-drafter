import type { DraftInput } from "./prompt.ts";
import type { IssueFields } from "./schema.ts";

// A URL ends at whitespace, quotes, a backtick or a closing bracket, so one
// wrapped in Markdown link syntax or parentheses ends where its wrapper does.
const URL_PATTERN = /https?:\/\/[^\s<>"'`)\]]+/g;
const MARKDOWN_LINK = /\[[^\]\n]+\]\(https?:\/\/[^\s<>"'`)\]]+\)/g;

export function findUrls(text: string): string[] {
  return [...text.matchAll(URL_PATTERN)].map((match) => match[0].replace(/[.,;:!?]+$/, ""));
}

function proseOf(fields: IssueFields): string {
  return Object.entries(fields)
    .filter(([key]) => key !== "type" && key !== "title")
    .flatMap(([, value]) => (Array.isArray(value) ? value : [value]))
    .join("\n");
}

// The model may only name links, never write them: every URL comes from the
// author, and every URL the note has must survive unless a correction drops it.
export function linkProblems(fields: IssueFields, input: DraftInput): string[] {
  const problems: string[] = [];
  const titleUrls = findUrls(fields.title);
  if (titleUrls.length > 0) problems.push("title must not contain URLs.");

  const prose = proseOf(fields);
  const known = new Set(findUrls([input.note, input.correction ?? "", input.previous ? proseOf(input.previous) : ""].join("\n")));
  const written = new Set([...titleUrls, ...findUrls(prose)]);
  for (const url of written) {
    if (!known.has(url)) problems.push(`${url} is not in the note. Use only URLs the note contains, copied exactly.`);
  }

  // `buildMessages` only applies a correction that comes with its draft.
  if (!(input.previous && input.correction)) {
    for (const url of new Set(findUrls(input.note))) {
      if (!written.has(url)) problems.push(`${url} from the note is missing. Include it as a Markdown link.`);
    }
  }

  for (const url of new Set(findUrls(prose.replace(MARKDOWN_LINK, "")))) {
    problems.push(`Write ${url} as a Markdown link: [short descriptive text](${url}).`);
  }
  return problems;
}
