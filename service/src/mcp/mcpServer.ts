import { governanceRequestSchema, governanceResponseSchema } from "../schemas/governanceSchemas.js";
import { resolveRepositoryPathForContext } from "../repository/repositoryPathResolver.js";
import type { RepositoryPathResolverOptions } from "../repository/repositoryPathResolver.js";
import type { RepositoryIssueProvider } from "../services/githubClient.js";
import { IssueGovernanceService } from "../services/issueGovernanceService.js";
import type { GovernanceRequest } from "../schemas/governanceSchemas.js";

const MCP_PROTOCOL_VERSION = "2026-07-28";
const SERVER_INFO = {
  name: "issue-governance-agent",
  version: "0.1.0"
};

export interface McpToolDefinition {
  name: string;
  description: string;
}

export const issueGovernanceTools: McpToolDefinition[] = [
  { name: "github_issue_list", description: "List real GitHub issues for the requested scope." },
  { name: "github_issue_govern", description: "Run full GitHub Issue governance analysis." },
  { name: "issue_dedupe", description: "Check duplicate issue candidates." },
  { name: "issue_clarify", description: "Generate clarification questions." },
  { name: "issue_split_tasks", description: "Split an issue into implementation tasks." },
  { name: "issue_generate_tests", description: "Generate test points for an issue." },
  { name: "issue_risk_report", description: "Generate an issue risk report." },
  {
    name: "issue_governance_digest",
    description: "Generate a governance digest for the requested issue scope."
  }
];

export interface IssueGovernanceToolOptions {
  service?: IssueGovernanceService;
  issueProvider?: RepositoryIssueProvider;
  repositoryPath?: string;
  repositoryPathResolverOptions?: RepositoryPathResolverOptions;
}

export interface JsonRpcRequest {
  jsonrpc: "2.0";
  id?: string | number;
  method: string;
  params?: unknown;
}

export type JsonRpcResponse =
  | {
      jsonrpc: "2.0";
      id: string | number;
      result: Record<string, unknown>;
    }
  | {
      jsonrpc: "2.0";
      id?: string | number;
      error: {
        code: number;
        message: string;
        data?: unknown;
      };
    };

const governanceInputSchema = {
  type: "object",
  properties: {
    source: { type: "string", enum: ["github", "uumit", "mcp", "api"] },
    requestId: { type: "string" },
    repo: { type: "string" },
    issueNumber: { type: "integer", minimum: 1 },
    issueRange: {
      type: "object",
      properties: {
        state: { type: "string", enum: ["open", "closed"] },
        limit: { type: "integer", minimum: 1, maximum: 100 },
        labels: { type: "array", items: { type: "string" } },
        since: { type: ["string", "null"], format: "date-time" }
      }
    },
    tasks: {
      type: "array",
      items: {
        type: "string",
        enum: ["dedupe", "clarify", "split_tasks", "generate_tests", "risk_report"]
      }
    },
    mode: {
      type: "string",
      enum: ["analyze_only", "comment_result", "draft_action", "apply_with_approval", "auto_apply"]
    },
    outputLanguage: { type: "string" }
  },
  required: ["repo"],
  anyOf: [{ required: ["issueNumber"] }, { required: ["issueRange"] }]
};

/**
 * Handles the minimal MCP JSON-RPC methods needed for tool discovery and calls.
 */
export async function handleMcpJsonRpcRequest(
  request: JsonRpcRequest,
  options: IssueGovernanceToolOptions = {}
): Promise<JsonRpcResponse | null> {
  if (request.id === undefined) {
    return null;
  }

  try {
    if (request.method === "initialize") {
      return result(request.id, {
        resultType: "complete",
        protocolVersion: MCP_PROTOCOL_VERSION,
        capabilities: {
          tools: {
            listChanged: false
          }
        },
        serverInfo: SERVER_INFO
      });
    }

    if (request.method === "tools/list") {
      return result(request.id, {
        resultType: "complete",
        tools: issueGovernanceTools.map((tool) => ({
          name: tool.name,
          title: tool.name,
          description: tool.description,
          inputSchema: governanceInputSchema
        }))
      });
    }

    if (request.method === "tools/call") {
      const params = parseToolCallParams(request.params);
      const toolResult = await handleIssueGovernanceTool(params.name, params.arguments, options);
      return result(request.id, {
        resultType: "complete",
        content: [{ type: "text", text: JSON.stringify(toolResult, null, 2) }],
        structuredContent: toolResult,
        isError: false
      });
    }

    return error(request.id, -32601, `Method not found: ${request.method}`);
  } catch (cause) {
    const message = cause instanceof Error ? cause.message : "Unknown MCP server error";
    const isExecutionError = message.startsWith("GITHUB_CONTEXT_UNAVAILABLE");

    if (isExecutionError) {
      return result(request.id, {
        resultType: "complete",
        content: [{ type: "text", text: message }],
        structuredContent: {
          errorCode: "GITHUB_CONTEXT_UNAVAILABLE",
          message
        },
        isError: true
      });
    }

    return error(request.id, -32602, message);
  }
}

/**
 * Handles issue governance tool calls for the HTTP and MCP adapters.
 */
export async function handleIssueGovernanceTool(
  toolName: string,
  input: unknown,
  options: IssueGovernanceToolOptions = {}
): Promise<unknown> {
  const service = options.service ?? new IssueGovernanceService();
  const request = governanceRequestSchema.parse(input);
  const repositoryPath = await resolveToolRepositoryPath(request.repo, options);
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

  if (!options.issueProvider) {
    throw new Error("GITHUB_CONTEXT_UNAVAILABLE: GitHub issue provider is required.");
  }

  if (toolName === "github_issue_list") {
    const issues =
      request.issueNumber !== undefined
        ? [
            (
              await options.issueProvider.getIssueContextByRepository(
                request.repo,
                request.issueNumber
              )
            ).issue
          ]
        : await options.issueProvider.listIssuesForGovernance(request.repo, request.issueRange!);

    return {
      repository: request.repo,
      issues: issues.map((issue) => ({
        number: issue.number,
        title: issue.title,
        state: issue.state,
        labels: issue.labels,
        updatedAt: issue.updatedAt
      }))
    };
  }

  if (request.issueNumber === undefined) {
    const issues = await options.issueProvider.listIssuesForGovernance(
      request.repo,
      request.issueRange!
    );
    const responses = await Promise.all(
      issues.map((issue) =>
        service.governIssue(issue, {
          tasks: taskOverrides[toolName] ?? request.tasks,
          candidateIssues: issues.filter((candidate) => candidate.number !== issue.number),
          mode: request.mode,
          repositoryPath
        })
      )
    );

    const results = responses.flatMap((response) => response.issues);
    return governanceResponseSchema.parse({
      repository: request.repo,
      mode: request.mode,
      summary: {
        analyzedIssues: results.length,
        duplicateGroups: results.filter((issue) => issue.dedupe.isDuplicate).length,
        unclearIssues: results.filter((issue) => issue.clarification.needed).length,
        highRiskIssues: results.filter((issue) =>
          ["high", "critical"].includes(issue.riskReport.level)
        ).length,
        suggestedTasks: results.reduce((total, issue) => total + issue.splitTasks.length, 0),
        testPoints: results.reduce((total, issue) => total + issue.testPoints.length, 0)
      },
      issues: results
    });
  }

  const { issue, candidateIssues } = await options.issueProvider.getIssueContextByRepository(
    request.repo,
    request.issueNumber
  );
  return service.governIssue(issue, {
    tasks: taskOverrides[toolName] ?? request.tasks,
    candidateIssues,
    mode: request.mode,
    repositoryPath
  });
}

async function resolveToolRepositoryPath(
  repo: string,
  options: IssueGovernanceToolOptions
): Promise<string | undefined> {
  if (options.repositoryPathResolverOptions) {
    return (await resolveRepositoryPathForContext(repo, options.repositoryPathResolverOptions))
      .repositoryPath;
  }

  return options.repositoryPath;
}

function parseToolCallParams(params: unknown): { name: string; arguments: unknown } {
  if (typeof params !== "object" || params === null) {
    throw new Error("Invalid tools/call params.");
  }

  const candidate = params as { name?: unknown; arguments?: unknown };
  if (typeof candidate.name !== "string") {
    throw new Error("tools/call params.name is required.");
  }

  return {
    name: candidate.name,
    arguments: candidate.arguments ?? {}
  };
}

function result(id: string | number, value: Record<string, unknown>): JsonRpcResponse {
  return {
    jsonrpc: "2.0",
    id,
    result: {
      ...value,
      _meta: {
        "io.modelcontextprotocol/serverInfo": SERVER_INFO
      }
    }
  };
}

function error(
  id: string | number,
  code: number,
  message: string,
  data?: unknown
): JsonRpcResponse {
  return {
    jsonrpc: "2.0",
    id,
    error: {
      code,
      message,
      data
    }
  };
}
