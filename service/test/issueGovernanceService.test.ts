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
        projectProfile: "Project profile summary",
        codeContext: "service/src/index.ts",
        fileList: ["service/src/index.ts"],
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
});
