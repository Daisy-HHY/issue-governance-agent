import { governanceRequestSchema } from "../schemas/governanceSchemas.js";
import { IssueGovernanceService } from "../services/issueGovernanceService.js";
import type { GovernanceRequest } from "../schemas/governanceSchemas.js";

export interface McpToolDefinition {
  name: string;
  description: string;
}

export const issueGovernanceTools: McpToolDefinition[] = [
  { name: "github_issue_list", description: "List GitHub issues. Current MVP returns request scope only." },
  { name: "github_issue_govern", description: "Run full GitHub Issue governance analysis." },
  { name: "issue_dedupe", description: "Check duplicate issue candidates." },
  { name: "issue_clarify", description: "Generate clarification questions." },
  { name: "issue_split_tasks", description: "Split an issue into implementation tasks." },
  { name: "issue_generate_tests", description: "Generate test points for an issue." },
  { name: "issue_risk_report", description: "Generate an issue risk report." },
  { name: "issue_governance_digest", description: "Generate a governance digest for the requested issue scope." }
];

/**
 * Handles MCP-style tool calls without adding an MCP SDK dependency yet.
 */
export async function handleIssueGovernanceTool(
  toolName: string,
  input: unknown,
  service = new IssueGovernanceService()
): Promise<unknown> {
  const request = governanceRequestSchema.parse(input);
  const taskOverrides: Partial<Record<string, GovernanceRequest["tasks"]>> = {
    issue_dedupe: ["dedupe"],
    issue_clarify: ["clarify"],
    issue_split_tasks: ["split_tasks"],
    issue_generate_tests: ["generate_tests"],
    issue_risk_report: ["risk_report"]
  };

  if (!issueGovernanceTools.some((tool) => tool.name === toolName)) {
    throw new Error(`Unknown MCP tool: ${toolName}`);
  }

  if (toolName === "github_issue_list") {
    return {
      repository: request.repo,
      issueNumbers: request.issueRange
        ? Array.from({ length: request.issueRange.limit }, (_item, index) => index + 1)
        : [request.issueNumber ?? 1],
      message: "MVP 未连接 GitHub 实时拉取，返回请求范围。"
    };
  }

  return service.governIssue(
    {
      repo: request.repo,
      number: request.issueNumber ?? 1,
      title: `Issue #${request.issueNumber ?? 1}`,
      body: "MCP 工具当前最小闭环未连接 GitHub 拉取，使用请求参数生成占位 Issue。",
      labels: request.issueRange?.labels ?? [],
      state: request.issueRange?.state ?? "open",
      author: "mcp",
      assignees: [],
      comments: [],
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString()
    },
    {
      tasks: taskOverrides[toolName] ?? request.tasks,
      mode: request.mode
    }
  );
}
