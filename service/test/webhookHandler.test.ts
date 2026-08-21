import { createHmac } from "node:crypto";
import { describe, expect, it } from "vitest";
import { createGitHubWebhookRoutes, verifyGitHubSignature } from "../src/github/webhookHandler.js";
import type { AppEnv } from "../src/config/env.js";
import type { GitHubClient } from "../src/services/githubClient.js";
import type { IssueGovernanceService } from "../src/services/issueGovernanceService.js";
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
  REPOSITORY_CONTEXT_MAP: "owner/project=D:/project/mapped-project",
  REPOSITORY_CONTEXT_PATH: "D:/project/issue-governance-agent",
  REPOSITORY_CONTEXT_ROOT: "",
  REPOSITORY_CONTEXT_PROVIDER: "auto",
  CODEGRAPH_SKILL_ENDPOINT: "",
  CODEGRAPH_MCP_COMMAND: "codegraph",
  CODEGRAPH_MCP_ARGS: "serve,--mcp",
  CODEGRAPH_MCP_MAX_FILES: 8,
  REPOSITORY_CONTEXT_REFRESH: "never",
  REPOSITORY_CONTEXT_REFRESH_TTL_SECONDS: 300,
  REPOSITORY_CONTEXT_AUTO_CLONE: false,
  LOG_LEVEL: "info"
};

describe("webhook handler", () => {
  it("verifies GitHub sha256 signatures", () => {
    const body = JSON.stringify({ ok: true });
    const signature = `sha256=${createHmac("sha256", env.GITHUB_WEBHOOK_SECRET).update(body).digest("hex")}`;

    expect(verifyGitHubSignature(body, env.GITHUB_WEBHOOK_SECRET, signature)).toBe(true);
    expect(verifyGitHubSignature(body, env.GITHUB_WEBHOOK_SECRET, "sha256=bad")).toBe(false);
  });

  it("handles issue_comment.created commands", async () => {
    const issue: RawIssue = {
      repo: "owner/project",
      number: 1,
      title: "Webhook blank response",
      body: "actual blank",
      labels: ["webhook"],
      state: "open",
      author: "daisy",
      assignees: [],
      comments: [],
      createdAt: "2026-08-16T00:00:00.000Z",
      updatedAt: "2026-08-16T00:00:00.000Z"
    };
    const githubClient = {
      getIssueContext: async () => ({ issue, candidateIssues: [] }),
      createIssueComment: async () => 100
    } as unknown as GitHubClient;
    let receivedRepositoryPath: string | undefined;
    const governanceService = {
      governIssue: async (_issue: RawIssue, options: { repositoryPath?: string }) => {
        receivedRepositoryPath = options.repositoryPath;
        return {
          repository: issue.repo,
          mode: "comment_result",
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
                module: "webhook",
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
                impactScope: ["webhook"],
                suggestion: ""
              },
              proposedActions: []
            }
          ]
        };
      }
    } as unknown as IssueGovernanceService;
    const app = createGitHubWebhookRoutes({
      env,
      githubClient,
      governanceService,
      repositoryPathResolverOptions: {
        repositoryContextMap: env.REPOSITORY_CONTEXT_MAP,
        fallbackRepositoryPath: env.REPOSITORY_CONTEXT_PATH
      }
    });
    const body = JSON.stringify({
      action: "created",
      installation: { id: 1 },
      repository: { name: "project", full_name: "owner/project", owner: { login: "owner" } },
      issue: { number: 1 },
      comment: {
        body: "/issue-govern",
        author_association: "OWNER",
        user: { login: "daisy", type: "User" }
      }
    });
    const signature = `sha256=${createHmac("sha256", env.GITHUB_WEBHOOK_SECRET).update(body).digest("hex")}`;

    const response = await app.request("/github", {
      method: "POST",
      headers: {
        "x-hub-signature-256": signature,
        "x-github-event": "issue_comment",
        "x-github-delivery": "delivery-1"
      },
      body
    });

    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ status: "commented", commentId: 100 });
    expect(receivedRepositoryPath).toBe("D:\\project\\mapped-project");
  });
});
