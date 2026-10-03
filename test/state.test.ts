import { describe, expect, it } from "vitest";
import { MAX_REPOS as API_MAX_REPOS } from "../src/handler.ts";
import { MAX_REPOS, restoreState, withRepo } from "../public/state.js";

const empty = { repos: [], type: "auto", note: "", fields: null, title: "", body: "" };

describe("restoreState", () => {
  it("restores what a previous session saved", () => {
    const saved = { repos: ["LoopifyBot", "dotfiles"], type: "bug", note: "n", fields: { type: "bug", title: "t" }, title: "t", body: "b" };
    expect(restoreState(saved)).toEqual(saved);
  });

  it("falls back to the default of each key whose shape does not fit", () => {
    expect(restoreState({ repos: ["LoopifyBot", 7], type: "epic", note: 3, fields: { type: "epic" }, title: null })).toEqual({
      ...empty, repos: ["LoopifyBot"],
    });
  });

  it.each([null, "garbage", 42, []])("starts empty from %j", (saved) => {
    expect(restoreState(saved)).toEqual(empty);
  });

  it("keeps the repository chosen before several could be", () => {
    expect(restoreState({ repo: "LoopifyBot" }).repos).toEqual(["LoopifyBot"]);
    expect(restoreState({ repo: "" }).repos).toEqual([]);
    expect(restoreState({ repo: "LoopifyBot", repos: ["dotfiles"] }).repos).toEqual(["dotfiles"]);
  });
});

describe("withRepo", () => {
  it("adds and removes a repository", () => {
    expect(withRepo(["LoopifyBot"], "dotfiles", true)).toEqual(["LoopifyBot", "dotfiles"]);
    expect(withRepo(["LoopifyBot", "dotfiles"], "LoopifyBot", false)).toEqual(["dotfiles"]);
  });

  it("never lists a repository twice", () => {
    expect(withRepo(["LoopifyBot"], "LoopifyBot", true)).toEqual(["LoopifyBot"]);
  });

  it("stops at the maximum the API accepts", () => {
    expect(MAX_REPOS).toBe(API_MAX_REPOS);
    const full = Array.from({ length: MAX_REPOS }, (_, i) => `repo-${i}`);
    expect(withRepo(full, "one-more", true)).toEqual(full);
  });
});
