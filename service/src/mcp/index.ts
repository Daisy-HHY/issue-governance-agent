import { createInterface } from "node:readline";
import { loadEnv } from "../config/env.js";
import { queryRelevantContext } from "../repository/repositoryContext.js";
import { GitHubClient } from "../services/githubClient.js";
import { IssueGovernanceService } from "../services/issueGovernanceService.js";
import { handleMcpJsonRpcRequest } from "./mcpServer.js";

const env = loadEnv();
const governanceService = new IssueGovernanceService((repoPath, issue) =>
  queryRelevantContext(repoPath, issue, {
    provider: env.REPOSITORY_CONTEXT_PROVIDER,
    skillEndpoint: env.CODEGRAPH_SKILL_ENDPOINT,
    mcpCommand: env.CODEGRAPH_MCP_COMMAND,
    mcpArgs: parseCsvList(env.CODEGRAPH_MCP_ARGS),
    mcpMaxFiles: env.CODEGRAPH_MCP_MAX_FILES
  })
);
const githubClient = new GitHubClient({
  appId: env.GITHUB_APP_ID,
  privateKey: env.GITHUB_APP_PRIVATE_KEY
});
const input = createInterface({
  input: process.stdin,
  crlfDelay: Infinity
});

input.on("line", (line) => {
  void handleLine(line);
});

/**
 * Processes one JSON-RPC message from the stdio transport.
 */
async function handleLine(line: string): Promise<void> {
  if (!line.trim()) {
    return;
  }

  try {
    const response = await handleMcpJsonRpcRequest(JSON.parse(line), {
      service: governanceService,
      issueProvider: githubClient,
      repositoryPathResolverOptions: {
        repositoryContextMap: env.REPOSITORY_CONTEXT_MAP,
        fallbackRepositoryPath: env.REPOSITORY_CONTEXT_PATH,
        repositoryContextRoot: env.REPOSITORY_CONTEXT_ROOT,
        autoClone: env.REPOSITORY_CONTEXT_AUTO_CLONE,
        refresh: env.REPOSITORY_CONTEXT_REFRESH,
        refreshTtlSeconds: env.REPOSITORY_CONTEXT_REFRESH_TTL_SECONDS,
        cloneTokenProvider: (repoFullName) => githubClient.getRepositoryAccessToken(repoFullName)
      }
    });

    if (response) {
      process.stdout.write(`${JSON.stringify(response)}\n`);
    }
  } catch (cause) {
    const message = cause instanceof Error ? cause.message : "Invalid JSON-RPC message.";
    process.stdout.write(
      JSON.stringify({ jsonrpc: "2.0", error: { code: -32700, message } }) + "\n"
    );
  }
}

function parseCsvList(value: string): string[] {
  return value
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);
}
