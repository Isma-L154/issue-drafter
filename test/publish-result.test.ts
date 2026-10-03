import { describe, expect, it } from "vitest";
import { failureMessage, resultTitle } from "../public/publish-result.js";

const issue = (repo: string, number: number) => ({ repo, number, url: `https://github.com/Isma-L154/${repo}/issues/${number}` });

describe("resultTitle", () => {
  it("names the repository of a single issue", () => {
    expect(resultTitle([issue("LoopifyBot", 7)])).toBe("Issue #7 created in LoopifyBot");
  });

  it("counts several issues", () => {
    expect(resultTitle([issue("LoopifyBot", 7), issue("dotfiles", 3)])).toBe("2 issues created");
  });
});

describe("failureMessage", () => {
  it("names each failed repository with its reason", () => {
    expect(failureMessage([{ repo: "blog", error: "The repository is unavailable." }, { repo: "infra", error: "Validation Failed" }]))
      .toBe("Not published to blog (The repository is unavailable), infra (Validation Failed). They stay selected to retry.");
  });

  it("speaks of a single repository in the singular", () => {
    expect(failureMessage([{ repo: "blog", error: "Gone." }])).toBe("Not published to blog (Gone). It stays selected to retry.");
  });
});
