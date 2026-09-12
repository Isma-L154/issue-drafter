// Runs the fixture notes through the real model and reports invented facts.
// Usage (PowerShell):
//   $env:CLOUDFLARE_API_TOKEN = "<token with Workers AI read>"; npm run eval
import { draftIssue, type TextModel } from "../src/ai.ts";
import { renderIssue } from "../src/render.ts";
import { NOTES } from "../test/fixtures/notes.ts";

const ACCOUNT_ID = process.env["CLOUDFLARE_ACCOUNT_ID"] ?? "51d7355a63c1a3eba08d8ef63a889b3b";
const MODEL = process.env["MODEL"] ?? "@cf/qwen/qwen3-30b-a3b-fp8";
const token = process.env["CLOUDFLARE_API_TOKEN"];
if (!token) {
  console.error("Set CLOUDFLARE_API_TOKEN first.");
  process.exit(2);
}

let neurons = 0;
const model: TextModel = {
  async run(name, input) {
    const response = await fetch(`https://api.cloudflare.com/client/v4/accounts/${ACCOUNT_ID}/ai/run/${name}`, {
      method: "POST",
      headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
      body: JSON.stringify(input),
    });
    const data = (await response.json()) as { success: boolean; result?: { usage?: { neurons?: number } }; errors?: unknown };
    if (!data.success) throw new Error(JSON.stringify(data.errors));
    neurons += data.result?.usage?.neurons ?? 0;
    return data.result;
  },
};

let failures = 0;
for (const sample of NOTES) {
  const problems: string[] = [];
  try {
    const fields = await draftIssue(model, MODEL, { note: sample.note, type: "auto" });
    const { title, body } = renderIssue(fields);
    if (fields.type !== sample.expectedType) problems.push(`type ${fields.type}, expected ${sample.expectedType}`);
    // Numbered-list markers come from the template, not from the model.
    const prose = `${title}\n${body}`.replace(/^\d+\. /gm, "");
    const invented = [...prose.matchAll(/\d+/g)].map((m) => m[0]).filter((digits) => !sample.note.includes(digits));
    if (invented.length > 0) problems.push(`numbers not in the note: ${[...new Set(invented)].join(", ")}`);
    if (fields.type === "bug" && !sample.statesSteps && fields.steps.length > 0) problems.push("invented reproduction steps");
    if (fields.acceptance.length === 0) problems.push("no acceptance criteria");
    console.log(`\n=== ${sample.id}: ${problems.length === 0 ? "OK" : "FAIL"}\n# ${title}\n${body}`);
  } catch (error) {
    problems.push(error instanceof Error ? error.message : String(error));
    console.log(`\n=== ${sample.id}: FAIL`);
  }
  for (const problem of problems) console.log(`  - ${problem}`);
  if (problems.length > 0) failures++;
}

console.log(`\n${NOTES.length - failures}/${NOTES.length} passed, ${neurons.toFixed(1)} Neurons spent.`);
process.exit(failures > 0 ? 1 : 0);
