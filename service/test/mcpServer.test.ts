import { describe, expect, it } from "vitest";
import {
  handleIssueGovernanceTool,
  handleMcpJsonRpcRequest,
  issueGovernanceTools
} from "../src/mcp/mcpServer.js";
import { IssueGovernanceService } from "../src/services/issueGovernanceService.js";
import type { RepositoryIssueProvider } from "../src/services/githubClient.js";
import type { RawIssue } from "../src/schemas/governanceSchemas.js";

const issue: RawIssue = {
  repo: "owner/project",
  number: 1,
  title: "MCP blank response bug",
  body: "blank response in MCP route",
  labels: ["mcp"],
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

describe("mcp server helpers", () => {
  it("lists all planned issue governance tools", () => {
    expect(issueGovernanceTools.map((tool) => tool.name)).toEqual([
      "github_issue_list",
      "github_issue_govern",
      "issue_dedupe",
      "issue_clarify",
      "issue_split_tasks",
      "issue_generate_tests",
      "issue_risk_report",
      "issue_governance_digest"
    ]);
  });

  it("handles a single-purpose risk report tool", async () => {
    const result = await handleIssueGovernanceTool(
      "issue_risk_report",
      {
        repo: "owner/project",
        issueNumber: 1
      },
      {
        issueProvider
      }
    );

    expect(JSON.stringify(result)).toContain("riskReport");
  });

  it("does not fabricate issues without a GitHub provider", async () => {
    await expect(
      handleIssueGovernanceTool("github_issue_govern", {
        repo: "owner/project",
        issueNumber: 1
      })
    ).rejects.toThrow("GITHUB_CONTEXT_UNAVAILABLE");
  });

  it("resolves repository context paths from the requested repo", async () => {
    let receivedRepositoryPath = "";
    const service = new IssueGovernanceService(async (repoPath) => {
      receivedRepositoryPath = repoPath;
      return {
        repoPath,
        query: "",
        keywords: [],
        projectProfile: "",
        codeContext: "context",
        fileList: [],
        contextSources: [],
        truncated: false
      };
    });

    await handleIssueGovernanceTool(
      "issue_risk_report",
      {
        repo: "owner/project",
        issueNumber: 1
      },
      {
        issueProvider,
        service,
        repositoryPathResolverOptions: {
          repositoryContextMap: "owner/project=D:/project/mcp-project",
          fallbackRepositoryPath: "D:/project/fallback"
        }
      }
    );

    expect(receivedRepositoryPath).toBe("D:\\project\\mcp-project");
  });

  it("exposes tools through MCP JSON-RPC methods", async () => {
    const initialize = await handleMcpJsonRpcRequest({
      jsonrpc: "2.0",
      id: 1,
      method: "initialize",
      params: {}
    });
    const list = await handleMcpJsonRpcRequest({
      jsonrpc: "2.0",
      id: 2,
      method: "tools/list",
      params: {}
    });
    const call = await handleMcpJsonRpcRequest(
      {
        jsonrpc: "2.0",
        id: 3,
        method: "tools/call",
        params: {
          name: "github_issue_list",
          arguments: {
            repo: "owner/project",
            issueRange: { state: "open", limit: 1 }
          }
        }
      },
      { issueProvider }
    );

    expect(JSON.stringify(initialize)).toContain("issue-governance-agent");
    expect(JSON.stringify(list)).toContain("github_issue_govern");
    expect(JSON.stringify(call)).toContain("MCP blank response bug");
  });
});
