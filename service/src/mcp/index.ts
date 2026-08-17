import { createInterface } from "node:readline";
import { loadEnv } from "../config/env.js";
import { GitHubClient } from "../services/githubClient.js";
import { IssueGovernanceService } from "../services/issueGovernanceService.js";
import { handleMcpJsonRpcRequest } from "./mcpServer.js";

const env = loadEnv();
const governanceService = new IssueGovernanceService();
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
        fallbackRepositoryPath: env.REPOSITORY_CONTEXT_PATH
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
