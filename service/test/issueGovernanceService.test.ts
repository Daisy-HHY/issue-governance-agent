import { describe, expect, it } from "vitest";
import { IssueGovernanceService } from "../src/services/issueGovernanceService.js";
import type { RawIssue } from "../src/schemas/governanceSchemas.js";

const issue: RawIssue = {
  repo: "owner/project",
  number: 42,
  title: "Webhook handler returns blank response",
  body: "/issue-govern\nThe health check is ok, but webhook response is blank.",
  labels: ["backend"],
  state: "open",
  author: "daisy",
  assignees: [],
  comments: [],
  createdAt: "2026-08-14T00:00:00.000Z",
  updatedAt: "2026-08-14T00:00:00.000Z"
};

describe("IssueGovernanceService", () => {
  it("prepares issue input without repository context", async () => {
    const service = new IssueGovernanceService();

    const prepared = await service.prepareInput(issue);

    expect(prepared.repositoryContext).toBeNull();
    expect(prepared.contextSources).toEqual([]);
    expect(prepared.promptContext).toContain("Do not invent files");
    expect(prepared.promptContext).toContain("Webhook handler returns blank response");
  });

  it("adds repository context when a repository path is provided", async () => {
    const service = new IssueGovernanceService(async (repoPath, contextIssue) => {
      expect(contextIssue.title).toBe(issue.title);

      return {
        repoPath,
        query: "webhook backend",
        keywords: ["webhook", "backend"],
        provider: "cli",
        projectProfile: "Project profile summary",
        codeContext: "service/src/index.ts",
        fileList: ["service/src/index.ts"],
        matchedFiles: ["service/src/index.ts"],
        warnings: ["CodeGraph uses tree-sitter approximation; use text search for exhaustive impact checks."],
        truncated: false,
        contextSources: [
          {
            type: "project_profile",
            status: "used",
            path: "项目知识图谱.md"
          },
          {
            type: "codegraph",
            status: "used",
            query: "webhook backend"
          }
        ]
      };
    });

    const prepared = await service.prepareInput(issue, {
      repositoryPath: "D:/project/issue-governance-agent"
    });

    expect(prepared.repositoryContext?.query).toBe("webhook backend");
    expect(prepared.contextSources).toHaveLength(2);
    expect(prepared.promptContext).toContain("Project profile summary");
    expect(prepared.promptContext).toContain("service/src/index.ts");
  });

  it("returns a schema-valid governance response", async () => {
    const service = new IssueGovernanceService();

    const response = await service.governIssue(issue, {
      tasks: ["clarify", "risk_report", "generate_tests"]
    });

    expect(response.summary.analyzedIssues).toBe(1);
    expect(response.issues[0]?.issueNumber).toBe(issue.number);
    expect(response.issues[0]?.proposedActions.every((action) => action.requiresApproval)).toBe(true);
  });

  it("uses repository context to avoid unknown classification for short issues", async () => {
    const resumeIssue: RawIssue = {
      ...issue,
      repo: "Chasen-Liao/resume-skills",
      number: 1,
      title: "简历压缩",
      body: "希望在简历编辑器中压缩简历展示内容，减少页面占用空间，同时保持模板样式和导出结果可用。",
      labels: []
    };
    const service = new IssueGovernanceService(async (repoPath) => ({
      repoPath,
      query: "简历压缩",
      keywords: ["简历压缩"],
      provider: "filesystem",
      projectProfile: "",
      codeContext: "No relevant code found for \"简历压缩\"",
      fileList: ["docs/app.js", "lib/editor-document.mjs", "assets/minimal-blue-business.png"],
      matchedFiles: [],
      warnings: ["CodeGraph skill provider is unavailable; CLI fallback was used."],
      truncated: false,
      contextSources: [{ type: "file_list", status: "used", path: repoPath }]
    }));

    const response = await service.governIssue(resumeIssue, {
      repositoryPath: "D:/project/issue-governance-agent-repos/Chasen-Liao/resume-skills"
    });
    const result = response.issues[0]!;

    expect(result.classification.type).toBe("task");
    expect(result.classification.module).toBe("resume");
    expect(result.splitTasks[0]?.type).toBe("frontend");
    expect(result.splitTasks[0]?.title).toBe("分析 resume 简历压缩路径");
    expect(result.testPoints).toContain("验证简历内容可自动压缩到一页。");
    expect(result.riskReport.reasons.join("\n")).toContain("仓库文件列表");
  });
});
