import { Hono } from "hono";
import { createUumitCapabilityRoutes } from "./api/uumitCapabilityRoutes.js";
import { createGitHubWebhookRoutes } from "./github/webhookHandler.js";
import { GitHubClient } from "./services/githubClient.js";
import { IssueGovernanceService } from "./services/issueGovernanceService.js";
import type { AppEnv } from "./config/env.js";

/**
 * Creates the HTTP app used by GitHub webhooks and UUMIT capability calls.
 */
export function createApp(env: AppEnv): Hono {
  const app = new Hono();
  const repositoryPath = env.REPOSITORY_CONTEXT_PATH || undefined;
  const governanceService = new IssueGovernanceService();
  const githubClient = new GitHubClient({
    appId: env.GITHUB_APP_ID,
    privateKey: env.GITHUB_APP_PRIVATE_KEY
  });

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
      repositoryPath
    })
  );
  app.route(
    "/api/v1",
    createUumitCapabilityRoutes({
      env,
      githubClient,
      governanceService,
      repositoryPath
    })
  );

  return app;
}
