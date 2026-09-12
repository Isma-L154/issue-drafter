const STORAGE_KEY = "issue-drafter:state";
const el = (id) => document.getElementById(id);
const state = { repo: "", type: "auto", note: "", fields: null, title: "", body: "" };

function loadState() {
  try {
    Object.assign(state, JSON.parse(localStorage.getItem(STORAGE_KEY) ?? "{}"));
  } catch {
    // Storage can be unavailable or hold garbage; the page works without it.
  }
}

function saveState() {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
  } catch {
    // Same as above.
  }
}

function setStatus(message, isError = false) {
  el("status").textContent = message;
  el("status").classList.toggle("error", isError);
}

function setBusy(busy) {
  for (const id of ["generate", "correct", "publish"]) el(id).disabled = busy;
}

async function api(path, body) {
  // Manual redirects: an expired Access session answers with a redirect to its
  // login page, which would otherwise surface as an opaque CORS failure.
  const init = { redirect: "manual" };
  if (body !== undefined) {
    init.method = "POST";
    init.headers = { "content-type": "application/json" };
    init.body = JSON.stringify(body);
  }
  const response = await fetch(path, init);
  if (response.type === "opaqueredirect") throw new Error("Your session expired. Reload the page.");

  let data = {};
  try {
    data = await response.json();
  } catch {
    // A non-JSON answer falls through to the generic message.
  }
  if (!response.ok) {
    const reset = data.resetAt ? ` It resets at ${new Date(data.resetAt).toLocaleString()}.` : "";
    throw new Error(`${data.error ?? `Request failed (${response.status}).`}${reset}`);
  }
  return data;
}

function showPreview() {
  const hasDraft = state.fields !== null;
  el("preview").hidden = !hasDraft;
  if (!hasDraft) return;
  el("detected-type").textContent = state.fields.type;
  el("title").value = state.title;
  el("body").value = state.body;
}

async function run(action) {
  setBusy(true);
  try {
    await action();
  } catch (error) {
    setStatus(error.message, true);
  } finally {
    setBusy(false);
  }
}

async function loadRepos() {
  const { repos } = await api("/api/repos");
  const select = el("repo");
  select.replaceChildren(new Option("Choose a repository", ""));
  for (const repo of repos) select.add(new Option(repo.private ? `${repo.name} (private)` : repo.name, repo.name));
  if (repos.some((repo) => repo.name === state.repo)) select.value = state.repo;
}

function applyDraft(data) {
  state.fields = data.fields;
  state.title = data.preview.title;
  state.body = data.preview.body;
  saveState();
  showPreview();
}

async function generate() {
  if (!state.note.trim()) throw new Error("Write a note first.");
  setStatus("Generating...");
  applyDraft(await api("/api/draft", { note: state.note, type: state.type }));
  setStatus("Draft ready. Review it before publishing.");
}

async function correct() {
  const correction = el("correction").value.trim();
  if (!correction) throw new Error("Write what should change.");
  setStatus("Applying the correction...");
  applyDraft(await api("/api/draft", { note: state.note, type: state.type, correction, previous: state.fields }));
  el("correction").value = "";
  setStatus("Draft updated.");
}

async function publish() {
  if (!state.repo) throw new Error("Choose a repository.");
  setStatus("Publishing...");
  const created = await api("/api/publish", { repo: state.repo, type: state.fields.type, title: state.title, body: state.body });
  Object.assign(state, { note: "", fields: null, title: "", body: "" });
  saveState();
  el("note").value = "";
  el("correction").value = "";
  showPreview();
  el("result").href = created.url;
  el("result").textContent = `Issue #${created.number} created`;
  el("result").hidden = false;
  setStatus("Published.");
}

function bind(id, key, event = "input") {
  el(id).addEventListener(event, () => {
    state[key] = el(id).value;
    saveState();
  });
}

document.addEventListener("DOMContentLoaded", () => {
  loadState();
  el("type").value = state.type;
  el("note").value = state.note;
  showPreview();

  bind("repo", "repo", "change");
  bind("type", "type", "change");
  bind("note", "note");
  bind("title", "title");
  bind("body", "body");

  el("generate").addEventListener("click", () => run(generate));
  el("correct").addEventListener("click", () => run(correct));
  el("publish").addEventListener("click", () => run(publish));

  run(loadRepos);
});
