import type { IssueFields, RequestedType } from "./schema.ts";

export interface DraftInput {
  note: string;
  type: RequestedType;
  correction?: string;
  previous?: IssueFields;
}

export interface ChatMessage {
  role: "system" | "user";
  content: string;
}

export const SYSTEM_PROMPT = `You turn a developer's informal note, usually written in Spanish, into the fields of a GitHub issue written in clear, professional English.

Answer with ONE JSON object and nothing else. Use the shape for its type:

{"type":"bug","title":"","summary":"","steps":[],"expected":"","actual":"","impact":"","acceptance":[],"openQuestions":[]}
{"type":"feature","title":"","goal":"","context":"","proposed":"","acceptance":[],"outOfScope":[],"openQuestions":[]}
{"type":"task","title":"","goal":"","context":"","scope":[],"acceptance":[],"outOfScope":[],"openQuestions":[]}

Rules:
- "bug": something that exists behaves wrongly. "feature": new or changed behavior. "task": refactoring, cleanup, investigation or maintenance. If a type is requested, use it.
- Bug titles describe the failure ("Bot hangs when loading long playlists"). Feature and task titles are imperative ("Load long playlists progressively"). At most 80 characters.
- Never invent facts: no versions, numbers, file names, commands, error messages or reproduction steps that the note does not state.
- steps: only when the note lists the actions taken, in order ("I open X, drag Y, press Z"). Describing a situation ("when I add a long playlist") is not a list of steps: put it in the summary and use [].
- expected and actual: restate only what the note says or directly implies.
- impact, context and outOfScope: only facts the note states, otherwise empty. Never describe the application, its screens or the user experience in general terms.
- acceptance: at least one checkable criterion that follows directly from what the note says should happen.
- openQuestions: at least one question whenever the note leaves out something a maintainer needs, such as where it happens, how often, since when, or what exactly should happen instead. Short notes almost always need questions. Use [] only when nothing is unclear.
- Keep the author's meaning. Do not add solutions, opinions or scope the note does not contain.`;

export function buildMessages(input: DraftInput, problems: string[] = []): ChatMessage[] {
  const parts = [`Requested type: ${input.type}`, `Note:\n"""\n${input.note}\n"""`];

  if (input.previous && input.correction) {
    parts.push(
      `Current draft:\n${JSON.stringify(input.previous)}`,
      `Correction from the author:\n"""\n${input.correction}\n"""`,
      "Apply the correction to the current draft and return the full corrected JSON. Keep everything the correction does not change.",
    );
  }

  if (problems.length > 0) {
    parts.push(`Your previous answer was rejected:\n${problems.map((p) => `- ${p}`).join("\n")}\nReturn a corrected JSON object.`);
  }

  // Qwen3 reasoning stays on. With `/no_think` a draft cost 4 Neurons instead of
  // 18, but the evaluation showed empty open questions on every note, including
  // a four-word one, and invented reproduction steps.
  return [
    { role: "system", content: SYSTEM_PROMPT },
    { role: "user", content: parts.join("\n\n") },
  ];
}
