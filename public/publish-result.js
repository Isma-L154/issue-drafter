/** @typedef {{ repo: string, number: number, url: string }} CreatedIssue */
/** @typedef {{ repo: string, error: string }} Failure */

/**
 * @param {CreatedIssue[]} created
 * @returns {string}
 */
export function resultTitle(created) {
  const [only] = created;
  return created.length === 1 && only ? `Issue #${only.number} created in ${only.repo}` : `${created.length} issues created`;
}

/**
 * @param {Failure[]} failed
 * @returns {string}
 */
export function failureMessage(failed) {
  const reasons = failed.map(({ repo, error }) => `${repo} (${error.replace(/\.$/, "")})`).join(", ");
  return `Not published to ${reasons}. ${failed.length === 1 ? "It stays" : "They stay"} selected to retry.`;
}
