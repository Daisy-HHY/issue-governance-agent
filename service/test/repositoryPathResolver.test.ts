import path from "node:path";
import { describe, expect, it } from "vitest";
import { resolveRepositoryPath } from "../src/repository/repositoryPathResolver.js";

describe("repository path resolver", () => {
  it("resolves a repository from REPOSITORY_CONTEXT_MAP", () => {
    const result = resolveRepositoryPath("Owner/Repo", {
      repositoryContextMap: "owner/repo=D:/project/repo"
    });

    expect(result).toMatchObject({
      repository: "Owner/Repo",
      repositoryPath: path.resolve("D:/project/repo"),
      source: "map"
    });
  });

  it("supports multiple mappings and case-insensitive repository names", () => {
    const result = resolveRepositoryPath("Chasen-Liao/resume-skills", {
      repositoryContextMap:
        "daisy-hhy/issue-governance-agent=D:/project/issue-governance-agent,chasen-liao/resume-skills=D:/project/resume-skills"
    });

    expect(result.repositoryPath).toBe(path.resolve("D:/project/resume-skills"));
    expect(result.source).toBe("map");
  });

  it("uses the fallback path when the map does not match", () => {
    const result = resolveRepositoryPath("owner/missing", {
      repositoryContextMap: "owner/repo=D:/project/repo",
      fallbackRepositoryPath: "D:/project/fallback"
    });

    expect(result.repositoryPath).toBe(path.resolve("D:/project/fallback"));
    expect(result.source).toBe("fallback");
  });

  it("returns missing when no path is configured", () => {
    const result = resolveRepositoryPath("owner/repo", {
      repositoryContextMap: "bad-entry,"
    });

    expect(result.repositoryPath).toBeUndefined();
    expect(result.source).toBe("missing");
  });
});
