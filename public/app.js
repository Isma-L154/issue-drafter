const STORAGE_KEY = "issue-drafter:state";
const TYPES = ["auto", "bug", "feature", "task"];
const el = (id) => document.getElementById(id);
const state = { repo: "", type: "auto", note: "", fields: null, title: "", body: "" };
let statusTimer;

function loadState() {
  try {
    Object.assign(state, JSON.parse(localStorage.getItem(STORAGE_KEY) ?? "{}"));
  } catch {
    // Storage can be unavailable or hold garbage; the page works without it.
  }
  if (!TYPES.includes(state.type)) state.type = "auto";
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
function appendInline(parent, text) {
  text.split("`").forEach((part, i) => {
    if (part === "") return;
    if (i % 2 === 1) {
      const code = document.createElement("code");
      code.textContent = part;
      parent.append(code);
    } else {
      parent.append(part);
    }
  });
}

// Renders the subset of Markdown the templates produce: headings, paragraphs,
// bullet, numbered and checkbox lists.
function renderMarkdown(markdown) {
  const nodes = [];
  let list = null;
  let paragraph = null;

  for (const line of markdown.split("\n")) {
    const text = line.trim();
    const heading = text.match(/^#{1,6}\s+(.+)$/);
    const item = text.match(/^(?:[-*]|(\d+)\.)\s+(?:\[([ xX])\]\s+)?(.+)$/);

    if (text === "") {
      list = paragraph = null;
    } else if (heading) {
      list = paragraph = null;
      const h3 = document.createElement("h3");
      appendInline(h3, heading[1]);
      nodes.push(h3);
    } else if (item) {
      paragraph = null;
      const tag = item[1] ? "OL" : "UL";
      if (list?.tagName !== tag) {
        list = document.createElement(tag);
        nodes.push(list);
      }
      const li = document.createElement("li");
      if (item[2] !== undefined) {
        const box = document.createElement("input");
        box.type = "checkbox";
        box.disabled = true;
        box.checked = item[2].toLowerCase() === "x";
        li.className = "task-item";
        li.append(box);
      }
      appendInline(li, item[3]);
      list.append(li);
    } else {
      list = null;
      if (paragraph) {
        paragraph.append(" ");
      } else {
        paragraph = document.createElement("p");
        nodes.push(paragraph);
      }
      appendInline(paragraph, text);
    }
  }

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

async function loadRepos() {
  const select = el("repo");
  let repos;
  try {
    ({ repos } = await api("/api/repos"));
  } catch (error) {
    select.replaceChildren(new Option("Could not load repositories", ""));
    throw error;
  }
  select.replaceChildren(new Option(repos.length ? "Choose a repository" : "No repositories with issues enabled", ""));
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

async function publish() {
  if (!state.repo) {
    el("repo").focus();
    throw new Error("Choose a repository.");
  }
  if (!state.title.trim() || !state.body.trim()) throw new Error("The title and body cannot be empty.");
  setStatus("Publishing...", "busy");
  const created = await api("/api/publish", { repo: state.repo, type: state.fields.type, title: state.title, body: state.body });
  state.note = "";
  el("note").value = "";
  updateCounter("note", "note-count");
  clearDraft();
  el("result").href = created.url;
  el("result-title").textContent = `Issue #${created.number} created in ${state.repo}`;
  el("result").hidden = false;
  setStatus("Published.", "success");
  window.scrollTo({ top: 0, behavior: "smooth" });
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

  bind("repo", "repo", "change");
  bind("note", "note");
  bind("title", "title");
  bind("body", "body");
  el("note").addEventListener("input", () => updateCounter("note", "note-count"));
  el("title").addEventListener("input", () => updateCounter("title", "title-count"));

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
