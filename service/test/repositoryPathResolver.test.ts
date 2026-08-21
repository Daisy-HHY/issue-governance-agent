import { mkdirSync, mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  resolveRepositoryPath,
  resolveRepositoryPathForContext
} from "../src/repository/repositoryPathResolver.js";
import type { CloneCommandRunner } from "../src/repository/repositoryPathResolver.js";

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

  it("auto clones a repository into the configured context root", async () => {
    const rootPath = mkdtempSync(path.join(tmpdir(), "issue-governance-repos-"));
    const calls: Array<{ command: string; args: string[]; cwd: string; env?: NodeJS.ProcessEnv }> =
      [];
    const runner: CloneCommandRunner = async (command, args, options) => {
      calls.push({ command, args, cwd: options.cwd, env: options.env });
      return { exitCode: 0, stdout: "", stderr: "" };
    };

    const result = await resolveRepositoryPathForContext("Owner/Repo", {
      repositoryContextRoot: rootPath,
      autoClone: true,
      cloneTokenProvider: async () => "token-for-test",
      cloneCommandRunner: runner
    });

    expect(result).toMatchObject({
      repository: "Owner/Repo",
      repositoryPath: path.resolve(rootPath, "Owner", "Repo"),
      source: "clone"
    });
    expect(calls).toHaveLength(1);
    expect(calls[0]).toMatchObject({
      command: "git",
      cwd: rootPath
    });
    expect(calls[0].args).toEqual([
      "-c",
      `http.extraheader=AUTHORIZATION: basic ${Buffer.from("x-access-token:token-for-test").toString("base64")}`,
      "clone",
      "--depth",
      "1",
      "https://github.com/Owner/Repo.git",
      path.resolve(rootPath, "Owner", "Repo")
    ]);
    expect(calls[0].env).toMatchObject({
      GIT_TERMINAL_PROMPT: "0",
      GCM_INTERACTIVE: "Never"
    });
  });

  it("uses fallback path when auto clone fails", async () => {
    const result = await resolveRepositoryPathForContext("owner/repo", {
      repositoryContextRoot: mkdtempSync(path.join(tmpdir(), "issue-governance-repos-")),
      autoClone: true,
      fallbackRepositoryPath: "D:/project/fallback",
      cloneCommandRunner: async () => ({
        exitCode: 128,
        stdout: "",
        stderr: "fatal: could not read from remote repository"
      })
    });

    expect(result.repositoryPath).toBe(path.resolve("D:/project/fallback"));
    expect(result.source).toBe("fallback");
  });

  it("uses fallback path when clone token lookup fails", async () => {
    const result = await resolveRepositoryPathForContext("owner/repo", {
      repositoryContextRoot: mkdtempSync(path.join(tmpdir(), "issue-governance-repos-")),
      autoClone: true,
      fallbackRepositoryPath: "D:/project/fallback",
      cloneTokenProvider: async () => {
        throw new Error("installation not found");
      }
    });

    expect(result.repositoryPath).toBe(path.resolve("D:/project/fallback"));
    expect(result.source).toBe("fallback");
  });

  it("refreshes an existing auto-clone cache when configured", async () => {
    const rootPath = mkdtempSync(path.join(tmpdir(), "issue-governance-repos-"));
    const targetPath = path.resolve(rootPath, "owner", "repo");
    mkdirSync(path.join(targetPath, ".git"), { recursive: true });
    const calls: string[][] = [];

    const result = await resolveRepositoryPathForContext("owner/repo", {
      repositoryContextRoot: rootPath,
      autoClone: true,
      refresh: "always",
      cloneTokenProvider: async () => "token-for-test",
      cloneCommandRunner: async (command, args) => {
        calls.push([command, ...args]);
        return { exitCode: 0, stdout: "updated", stderr: "" };
      }
    });

    expect(result.repositoryPath).toBe(targetPath);
    expect(result.message).toContain("Repository cache refreshed");
    expect(calls).toEqual([
      [
        "git",
        "-c",
        `http.extraheader=AUTHORIZATION: basic ${Buffer.from("x-access-token:token-for-test").toString("base64")}`,
        "pull",
        "--ff-only",
        "--depth",
        "1"
      ]
    ]);
  });
});
