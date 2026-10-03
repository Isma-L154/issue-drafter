/** @typedef {{ repos: string[], type: string, note: string, fields: object | null, title: string, body: string }} State */

// The API refuses more; see MAX_REPOS in src/handler.ts.
export const MAX_REPOS = 10;
const ISSUE_TYPES = ["bug", "feature", "task"];
const TYPES = ["auto", ...ISSUE_TYPES];

/**
 * @param {unknown} value
 * @returns {value is object}
 */
const isDraft = (value) =>
  typeof value === "object" && value !== null && "type" in value && typeof value.type === "string" && ISSUE_TYPES.includes(value.type);

/**
 * @param {Record<string, unknown>} saved
 * @returns {string[]}
 */
function savedRepos(saved) {
  const { repos, repo } = saved;
  if (Array.isArray(repos)) return repos.filter((name) => typeof name === "string");
  // Written before several repositories could be chosen.
  return typeof repo === "string" && repo !== "" ? [repo] : [];
}

// What is stored was written by an older version of this page as often as by
// the last session, so each key is restored only when its shape still fits.
// Anything else falls back to the empty default rather than reaching the DOM.
/**
 * @param {unknown} value
 * @returns {State}
 */
export function restoreState(value) {
  /** @type {Record<string, unknown>} */
  const saved = typeof value === "object" && value !== null ? { ...value } : {};
  /** @param {string} key */
  const text = (key) => {
    const field = saved[key];
    return typeof field === "string" ? field : "";
  };
  const { type, fields } = saved;
  return {
    repos: savedRepos(saved),
    type: typeof type === "string" && TYPES.includes(type) ? type : "auto",
    note: text("note"),
    fields: isDraft(fields) ? fields : null,
    title: text("title"),
    body: text("body"),
  };
}

/**
 * @param {string[]} repos
 * @param {string} name
 * @param {boolean} selected
 * @returns {string[]}
 */
export function withRepo(repos, name, selected) {
  const others = repos.filter((repo) => repo !== name);
  return selected && others.length < MAX_REPOS ? [...others, name] : others;
}
