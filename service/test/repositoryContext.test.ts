import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  ensureCodeGraph,
  extractIssueKeywords,
  loadProjectProfile,
  queryRelevantContext,
  refreshProjectProfile
} from "../src/repository/repositoryContext.js";
import type { CommandRunner } from "../src/repository/repositoryContext.js";

const tempRepos: string[] = [];

async function createTempRepo(): Promise<string> {
  const repoPath = await mkdtemp(path.join(os.tmpdir(), "issue-governance-context-"));
  tempRepos.push(repoPath);
  return repoPath;
}

afterEach(async () => {
  await Promise.all(tempRepos.splice(0).map((repoPath) => rm(repoPath, { force: true, recursive: true })));
});

describe("repository context", () => {
  it("syncs CodeGraph when the repository already has an index", async () => {
    const repoPath = await createTempRepo();
    await mkdir(path.join(repoPath, ".codegraph"));
    const calls: string[][] = [];
    const runner: CommandRunner = async (command, args) => {
      calls.push([command, ...args]);
      return { exitCode: 0, stdout: "synced", stderr: "" };
    };

    const result = await ensureCodeGraph(repoPath, { runner });

    expect(result.status).toBe("used");
    expect(result.action).toBe("sync");
    expect(calls).toEqual([["codegraph", "sync"]]);
  });

  it("initializes CodeGraph when the index is missing", async () => {
    const repoPath = await createTempRepo();
    const calls: string[][] = [];
    const runner: CommandRunner = async (command, args) => {
      calls.push([command, ...args]);
      return { exitCode: 0, stdout: "initialized", stderr: "" };
    };

    const result = await ensureCodeGraph(repoPath, { runner });

    expect(result.status).toBe("used");
    expect(result.action).toBe("init");
    expect(calls).toEqual([["codegraph", "init"]]);
  });

  it("returns a downgrade status when CodeGraph fails", async () => {
    const repoPath = await createTempRepo();
    const runner: CommandRunner = async () => ({
      exitCode: 1,
      stdout: "",
      stderr: "boom",
      message: "boom"
    });

    const result = await ensureCodeGraph(repoPath, { runner });

    expect(result.status).toBe("failed");
    expect(result.source.message).toContain("boom");
  });

  it("loads an empty project profile when 项目知识图谱.md is missing", async () => {
    const repoPath = await createTempRepo();

    const profile = await loadProjectProfile(repoPath);

    expect(profile.exists).toBe(false);
    expect(profile.content).toBe("");
    expect(profile.source.status).toBe("missing");
  });

  it("refreshes the project profile with current repository links", async () => {
    const repoPath = await createTempRepo();
    await mkdir(path.join(repoPath, "service", "src"), { recursive: true });
    await writeFile(path.join(repoPath, "service", "README.md"), "# Service", "utf8");
    await writeFile(path.join(repoPath, "service", "src", "index.ts"), "export {}", "utf8");

    const profile = await refreshProjectProfile(repoPath);

    expect(profile.exists).toBe(true);
    expect(profile.content).toContain("[index.ts](service/src/index.ts)");
    expect(profile.content).not.toContain("pi-agent-desktop");
  });

  it("extracts safe issue keywords without keeping the slash command", () => {
    const keywords = extractIssueKeywords({
      title: "PDF export fails in service/src/index.ts",
      body: "/issue-govern\nGET /health returns blank response",
      labels: ["backend", "bug"]
    });

    expect(keywords).toContain("service/src/index.ts");
    expect(keywords).toContain("backend");
    expect(keywords).not.toContain("/issue-govern");
  });

  it("returns bounded context and records sources", async () => {
    const repoPath = await createTempRepo();
    await mkdir(path.join(repoPath, ".codegraph"));
    await writeFile(path.join(repoPath, "项目知识图谱.md"), "profile".repeat(20), "utf8");
    const runner: CommandRunner = async (_command, args) => ({
      exitCode: 0,
      stdout: args[0] === "explore" ? "code".repeat(20) : "ok",
      stderr: ""
    });

    const context = await queryRelevantContext(
      repoPath,
      {
        title: "Webhook handler fails",
        body: "Check service/src/index.ts",
        labels: ["backend"]
      },
      {
        runner,
        profileLimit: 12,
        codeContextLimit: 10
      }
    );

    expect(context.projectProfile).toContain("[内容已截断");
    expect(context.codeContext).toContain("[内容已截断");
    expect(context.contextSources.map((source) => source.type)).toContain("codegraph");
    expect(context.fileList).toContain("项目知识图谱.md");
  });
});
