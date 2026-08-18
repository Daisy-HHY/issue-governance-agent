import { describe, expect, it } from "vitest";
import { createUumitCapabilityRoutes } from "../src/api/uumitCapabilityRoutes.js";
import { IssueGovernanceService } from "../src/services/issueGovernanceService.js";
import type { AppEnv } from "../src/config/env.js";
import type { RepositoryIssueProvider } from "../src/services/githubClient.js";
import type { RawIssue } from "../src/schemas/governanceSchemas.js";

const env: AppEnv = {
  PORT: 3000,
  GITHUB_APP_ID: "1",
  GITHUB_APP_PRIVATE_KEY: "key",
  GITHUB_WEBHOOK_SECRET: "secret",
  GITHUB_TRIGGER_USERS: "",
  GITHUB_TRIGGER_ASSOCIATIONS: "OWNER,MEMBER,COLLABORATOR",
  UUMIT_API_KEY: "uumit",
  OPENAI_API_KEY: "openai",
  OPENAI_MODEL: "gpt-4.1-mini",
  OPENAI_EMBEDDING_MODEL: "text-embedding-3-small",
  REPOSITORY_CONTEXT_MAP: "owner/project=D:/project/uumit-project",
  REPOSITORY_CONTEXT_PATH: "D:/project/issue-governance-agent",
  REPOSITORY_CONTEXT_ROOT: "",
  REPOSITORY_CONTEXT_AUTO_CLONE: false,
  LOG_LEVEL: "info"
};

const issue: RawIssue = {
  repo: "owner/project",
  number: 1,
  title: "UUMIT blank response bug",
  body: "blank response in UUMIT route",
  labels: ["uumit"],
  state: "open",
  author: "daisy",
  assignees: [],
  comments: [],
  createdAt: "2026-08-16T00:00:00.000Z",
  updatedAt: "2026-08-16T00:00:00.000Z"
};

const issueProvider: RepositoryIssueProvider = {
  getIssueContextByRepository: async () => ({ issue, candidateIssues: [] }),
  listIssuesForGovernance: async () => [issue]
};

describe("uumit capability routes", () => {
  it("rejects requests without API key", async () => {
    const app = createUumitCapabilityRoutes({
      env,
      governanceService: new IssueGovernanceService()
    });

    const response = await app.request("/github/issues/govern", {
      method: "POST",
      body: JSON.stringify({ repo: "owner/project", issueNumber: 1 })
    });

    expect(response.status).toBe(401);
  });

  it("rejects requests when UUMIT API key is not configured", async () => {
    const app = createUumitCapabilityRoutes({
      env: { ...env, UUMIT_API_KEY: "" },
      governanceService: new IssueGovernanceService()
    });

    const response = await app.request("/github/issues/govern", {
      method: "POST",
      body: JSON.stringify({ repo: "owner/project", issueNumber: 1 })
    });

    expect(response.status).toBe(401);
  });

  it("fails instead of generating placeholder issues without GitHub context", async () => {
    const app = createUumitCapabilityRoutes({
      env,
      governanceService: new IssueGovernanceService()
    });

    const response = await app.request("/github/issues/govern", {
      method: "POST",
      headers: {
        "x-api-key": env.UUMIT_API_KEY,
        "content-type": "application/json"
      },
      body: JSON.stringify({ repo: "owner/project", issueRange: { state: "open", limit: 3 } })
    });

    expect(response.status).toBe(424);
    expect(await response.json()).toMatchObject({
      status: "failed",
      errorCode: "GITHUB_CONTEXT_UNAVAILABLE",
      repository: "owner/project"
    });
  });

  it("returns a governance response and reuses the same requestId", async () => {
    let receivedRepositoryPath: string | undefined;
    const governanceService = {
      governIssue: async (_issue: RawIssue, options: { repositoryPath?: string }) => {
        receivedRepositoryPath = options.repositoryPath;
        return {
          repository: issue.repo,
          mode: "analyze_only",
          summary: {
            analyzedIssues: 1,
            duplicateGroups: 0,
            unclearIssues: 0,
            highRiskIssues: 0,
            suggestedTasks: 0,
            testPoints: 0
          },
          issues: [
            {
              issueNumber: issue.number,
              title: issue.title,
              classification: {
                type: "bug",
                module: "uumit",
                clarityScore: 0.8,
                riskLevel: "low"
              },
              dedupe: {
                isDuplicate: false,
                canonicalIssue: null,
                duplicateCandidates: [],
                confidence: 0,
                reason: ""
              },
              clarification: {
                needed: false,
                missingFields: [],
                questions: [],
                commentDraft: ""
              },
              splitTasks: [],
              testPoints: [],
              riskReport: {
                level: "low",
                reasons: ["ok"],
                impactScope: ["uumit"],
                suggestion: ""
              },
              proposedActions: []
            }
          ]
        };
      }
    } as unknown as IssueGovernanceService;
    const app = createUumitCapabilityRoutes({
      env,
      githubClient: issueProvider,
      governanceService,
      repositoryPathResolverOptions: {
        repositoryContextMap: env.REPOSITORY_CONTEXT_MAP,
        fallbackRepositoryPath: env.REPOSITORY_CONTEXT_PATH
      }
    });
    const request = {
      source: "uumit",
      requestId: "req-1",
      repo: "owner/project",
      issueNumber: 1,
      tasks: ["risk_report"]
    };

    const first = await app.request("/github/issues/govern", {
      method: "POST",
      headers: {
        "x-api-key": env.UUMIT_API_KEY,
        "content-type": "application/json"
      },
      body: JSON.stringify(request)
    });
    const second = await app.request("/github/issues/govern", {
      method: "POST",
      headers: {
        "x-api-key": env.UUMIT_API_KEY,
        "content-type": "application/json"
      },
      body: JSON.stringify(request)
    });

    expect(first.status).toBe(200);
    expect(await first.json()).toMatchObject({
      requestId: "req-1",
      status: "succeeded",
      capability: "github_issue_governance"
    });
    expect(await second.json()).toMatchObject({ requestId: "req-1" });
    expect(receivedRepositoryPath).toBe("D:\\project\\uumit-project");
  });
});
