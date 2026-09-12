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
- steps: only steps the note actually describes, otherwise [].
- impact, context and outOfScope: only if the note gives them, otherwise empty.
- acceptance: at least one checkable criterion that follows directly from what the note says should happen.
- openQuestions: what a maintainer would need to ask because the note leaves it unclear. Use [] only when nothing is unclear.
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

  // Qwen3 reasons before answering unless told not to. Measured: thinking cost
  // 18 Neurons and 4.3 s per draft, without it 4 Neurons and 1.7 s.
  parts.push("/no_think");

  return [
    { role: "system", content: SYSTEM_PROMPT },
    { role: "user", content: parts.join("\n\n") },
  ];
}
