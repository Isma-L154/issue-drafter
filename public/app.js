import { parseMarkdown, splitInline } from "./markdown.js";
import { failureMessage, resultTitle } from "./publish-result.js";
import { MAX_REPOS, restoreState, withRepo } from "./state.js";

const STORAGE_KEY = "issue-drafter:state";
const el = (id) => document.getElementById(id);
const state = restoreState(null);
let statusTimer;

function loadState() {
  let saved = null;
  try {
    saved = JSON.parse(localStorage.getItem(STORAGE_KEY) ?? "null");
  } catch {
    // Storage can be unavailable or hold garbage; the page works without it.
  }
  Object.assign(state, restoreState(saved));
}

function saveState() {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
  } catch {
    // Same as above.
  }
}

// kind: "info", "busy", "success" or "error". Success messages fade on their own.
function setStatus(message, kind = "info") {
  clearTimeout(statusTimer);
  el("status").textContent = message;
  el("status").dataset.kind = kind;
  if (kind === "success") statusTimer = setTimeout(() => setStatus(""), 4000);
}

function setBusy(busyId) {
  for (const id of ["generate", "correct", "publish", "discard"]) {
    el(id).disabled = busyId !== null;
    if (id === busyId) el(id).setAttribute("aria-busy", "true");
    else el(id).removeAttribute("aria-busy");
  }
}

function updateCounter(inputId, counterId) {
  const { value, maxLength } = el(inputId);
  el(counterId).textContent = `${value.length} / ${maxLength}`;
  el(counterId).classList.toggle("near", value.length > maxLength * 0.9);
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

// Backticks become <code>; everything else stays text, so nothing is parsed as HTML.
function inlineNodes(text) {
  return splitInline(text).map((part) => {
    if (!part.code) return part.text;
    const code = document.createElement("code");
    code.textContent = part.text;
    return code;
  });
}

function listItemNode(item) {
  const li = document.createElement("li");
  if (item.checked !== null) {
    const box = document.createElement("input");
    box.type = "checkbox";
    box.disabled = true;
    box.checked = item.checked;
    li.className = "task-item";
    li.append(box);
  }
  li.append(...inlineNodes(item.text));
  return li;
}

function blockNode(block) {
  if (block.kind === "list") {
    const list = document.createElement(block.ordered ? "ol" : "ul");
    list.append(...block.items.map(listItemNode));
    return list;
  }
  const node = document.createElement(block.kind === "heading" ? "h3" : "p");
  node.append(...inlineNodes(block.text));
  return node;
}

function renderMarkdown(markdown) {
  const nodes = parseMarkdown(markdown).map(blockNode);
  if (nodes.length === 0) {
    const empty = document.createElement("p");
    empty.className = "empty";
    empty.textContent = "The body is empty.";
    nodes.push(empty);
  }
  el("rendered").replaceChildren(...nodes);
}

function showTab(rendered) {
  el("tab-write").setAttribute("aria-selected", String(!rendered));
  el("tab-render").setAttribute("aria-selected", String(rendered));
  el("body").hidden = rendered;
  el("rendered").hidden = !rendered;
  if (rendered) renderMarkdown(el("body").value);
}

function showPreview() {
  const hasDraft = state.fields !== null;
  el("preview").hidden = !hasDraft;
  if (!hasDraft) return;
  el("detected-type").textContent = state.fields.type;
  el("detected-type").dataset.type = state.fields.type;
  el("title").value = state.title;
  el("body").value = state.body;
  updateCounter("title", "title-count");
  if (!el("rendered").hidden) renderMarkdown(state.body);
}

async function run(action, buttonId = null) {
  setBusy(buttonId);
  try {
    await action();
  } catch (error) {
    setStatus(error.message, "error");
  } finally {
    setBusy(null);
  }
}

function setRepoMessage(text) {
  el("repo-message").textContent = text;
  el("repo-message").hidden = text === "";
}

function repoOption(repo) {
  const box = document.createElement("input");
  box.type = "checkbox";
  box.value = repo.name;
  const name = document.createElement("span");
  name.className = "repo-name";
  name.textContent = repo.name;
  const row = document.createElement("label");
  row.className = "repo-option";
  row.append(box, name);
  if (repo.private) {
    const tag = document.createElement("span");
    tag.className = "repo-tag";
    tag.textContent = "private";
    row.append(tag);
  }
  return row;
}

// Reflects `state.repos` on the boxes; at the maximum the rest are disabled.
function syncRepos() {
  const full = state.repos.length >= MAX_REPOS;
  for (const box of el("repos").querySelectorAll("input")) {
    box.checked = state.repos.includes(box.value);
    box.disabled = full && !box.checked;
  }
  el("repo-count").textContent = `${state.repos.length} / ${MAX_REPOS} selected`;
}

function toggleRepo(box) {
  state.repos = withRepo(state.repos, box.value, box.checked);
  saveState();
  syncRepos();
}

function filterRepos() {
  const query = el("repo-filter").value.trim().toLowerCase();
  let shown = 0;
  for (const box of el("repos").querySelectorAll("input")) {
    const match = box.value.toLowerCase().includes(query);
    box.parentElement.hidden = !match;
    if (match) shown++;
  }
  if (el("repos").children.length > 0) setRepoMessage(shown === 0 ? "No repositories match." : "");
}

async function loadRepos() {
  let repos;
  try {
    ({ repos } = await api("/api/repos"));
  } catch (error) {
    setRepoMessage("Could not load repositories.");
    throw error;
  }
  const names = new Set(repos.map((repo) => repo.name));
  state.repos = state.repos.filter((name) => names.has(name));
  saveState();
  el("repos").replaceChildren(...repos.map(repoOption));
  setRepoMessage(repos.length ? "" : "No repositories with issues enabled.");
  syncRepos();
  filterRepos();
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
  el("result").hidden = true;
  setStatus("Drafting the issue. This can take a few seconds...", "busy");
  applyDraft(await api("/api/draft", { note: state.note, type: state.type }));
  setStatus("Draft ready. Review it before publishing.", "success");
  el("preview").scrollIntoView({ behavior: "smooth", block: "start" });
}

async function correct() {
  const correction = el("correction").value.trim();
  if (!correction) throw new Error("Write what should change.");
  setStatus("Applying the correction...", "busy");
  applyDraft(await api("/api/draft", { note: state.note, type: state.type, correction, previous: state.fields }));
  el("correction").value = "";
  setStatus("Draft updated.", "success");
}

function clearDraft() {
  Object.assign(state, { fields: null, title: "", body: "" });
  saveState();
  el("correction").value = "";
  showTab(false);
  showPreview();
}

function showResult(created) {
  el("result-title").textContent = resultTitle(created);
  el("result-links").replaceChildren(...created.map((issue) => {
    const link = document.createElement("a");
    link.href = issue.url;
    link.target = "_blank";
    link.rel = "noopener noreferrer";
    link.textContent = `${issue.repo} #${issue.number}`;
    const item = document.createElement("li");
    item.append(link);
    return item;
  }));
  el("result").hidden = false;
}

async function publish() {
  if (state.repos.length === 0) {
    el("repo-filter").focus();
    throw new Error("Choose at least one repository.");
  }
  if (!state.title.trim() || !state.body.trim()) throw new Error("The title and body cannot be empty.");
  setStatus("Publishing...", "busy");
  const { created, failed } = await api("/api/publish", { repos: state.repos, type: state.fields.type, title: state.title, body: state.body });
  showResult(created);
  window.scrollTo({ top: 0, behavior: "smooth" });

  // The draft stays, with only the failed repositories selected, so a retry is one click.
  if (failed.length > 0) {
    state.repos = failed.map((failure) => failure.repo);
    saveState();
    syncRepos();
    throw new Error(failureMessage(failed));
  }
  state.note = "";
  el("note").value = "";
  updateCounter("note", "note-count");
  clearDraft();
  setStatus("Published.", "success");
}

function bind(id, key, event = "input") {
  el(id).addEventListener(event, () => {
    state[key] = el(id).value;
    saveState();
  });
}

function onCtrlEnter(id, handler) {
  el(id).addEventListener("keydown", (event) => {
    if (event.key === "Enter" && (event.ctrlKey || event.metaKey) && !el("generate").disabled) {
      event.preventDefault();
      handler();
    }
  });
}

document.addEventListener("DOMContentLoaded", () => {
  loadState();
  syncRepos();
  el("note").value = state.note;
  updateCounter("note", "note-count");
  for (const radio of document.querySelectorAll('input[name="type"]')) {
    radio.checked = radio.value === state.type;
    radio.addEventListener("change", () => {
      state.type = radio.value;
      saveState();
    });
  }
  showPreview();

  bind("note", "note");
  bind("title", "title");
  bind("body", "body");
  el("note").addEventListener("input", () => updateCounter("note", "note-count"));
  el("title").addEventListener("input", () => updateCounter("title", "title-count"));
  el("repos").addEventListener("change", (event) => toggleRepo(event.target));
  el("repo-filter").addEventListener("input", filterRepos);

  el("tab-write").addEventListener("click", () => showTab(false));
  el("tab-render").addEventListener("click", () => showTab(true));

  el("generate").addEventListener("click", () => run(generate, "generate"));
  el("correct").addEventListener("click", () => run(correct, "correct"));
  el("publish").addEventListener("click", () => run(publish, "publish"));
  el("discard").addEventListener("click", () => {
    clearDraft();
    setStatus("Draft discarded.", "success");
  });
  onCtrlEnter("note", () => run(generate, "generate"));
  onCtrlEnter("correction", () => run(correct, "correct"));

  run(loadRepos);
});
