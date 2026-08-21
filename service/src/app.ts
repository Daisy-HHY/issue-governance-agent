import { Hono } from "hono";
import { createUumitCapabilityRoutes } from "./api/uumitCapabilityRoutes.js";
import { createGitHubWebhookRoutes } from "./github/webhookHandler.js";
import { queryRelevantContext } from "./repository/repositoryContext.js";
import type { RepositoryPathResolverOptions } from "./repository/repositoryPathResolver.js";
import { GitHubClient } from "./services/githubClient.js";
import { IssueGovernanceService } from "./services/issueGovernanceService.js";
import type { AppEnv } from "./config/env.js";

/**
 * Creates the HTTP app used by GitHub webhooks and UUMIT capability calls.
 */
export function createApp(env: AppEnv): Hono {
  const app = new Hono();
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
  const repositoryPathResolverOptions: RepositoryPathResolverOptions = {
    repositoryContextMap: env.REPOSITORY_CONTEXT_MAP,
    fallbackRepositoryPath: env.REPOSITORY_CONTEXT_PATH,
    repositoryContextRoot: env.REPOSITORY_CONTEXT_ROOT,
    autoClone: env.REPOSITORY_CONTEXT_AUTO_CLONE,
    refresh: env.REPOSITORY_CONTEXT_REFRESH,
    refreshTtlSeconds: env.REPOSITORY_CONTEXT_REFRESH_TTL_SECONDS,
    cloneTokenProvider: (repoFullName) => githubClient.getRepositoryAccessToken(repoFullName)
  };

  app.get("/health", (context) => {
    return context.json({
      status: "ok",
      service: "issue-governance-agent"
    });
  });

  app.route(
    "/webhooks",
    createGitHubWebhookRoutes({
      env,
      githubClient,
      governanceService,
      repositoryPathResolverOptions
    })
  );
  app.route(
    "/api/v1",
    createUumitCapabilityRoutes({
      env,
      githubClient,
      governanceService,
      repositoryPathResolverOptions
    })
  );

  return app;
}

function parseCsvList(value: string): string[] {
  return value
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);
}
