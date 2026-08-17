import { createHmac, timingSafeEqual } from "node:crypto";
import { Hono } from "hono";
import { parseGovernanceCommand } from "./commandParser.js";
import { renderErrorComment, renderGovernanceComment } from "./commentRenderer.js";
import { canTriggerGovernance } from "./permission.js";
import { resolveRepositoryPath } from "../repository/repositoryPathResolver.js";
import type { AppEnv } from "../config/env.js";
import type { RepositoryPathResolverOptions } from "../repository/repositoryPathResolver.js";
import type { GitHubClient } from "../services/githubClient.js";
import type { IssueGovernanceService } from "../services/issueGovernanceService.js";

export interface GitHubWebhookDeps {
  env: AppEnv;
  githubClient: GitHubClient;
  governanceService: IssueGovernanceService;
  repositoryPathResolverOptions?: RepositoryPathResolverOptions;
  processedDeliveries?: Set<string>;
}

interface IssueCommentPayload {
  action: string;
  installation?: { id?: number };
  repository: { name: string; owner: { login: string }; full_name: string };
  issue: { number: number };
  comment: {
    body?: string;
    author_association?: string;
    user?: { login?: string; type?: string };
  };
  sender?: { login?: string; type?: string };
}

/**
 * Creates GitHub webhook routes for issue comment governance commands.
 */
export function createGitHubWebhookRoutes(deps: GitHubWebhookDeps): Hono {
  const app = new Hono();
  const processedDeliveries = deps.processedDeliveries ?? new Set<string>();

  app.post("/github", async (context) => {
    const rawBody = await context.req.text();
    const signature = context.req.header("x-hub-signature-256") ?? "";

    if (!verifyGitHubSignature(rawBody, deps.env.GITHUB_WEBHOOK_SECRET, signature)) {
      return context.json({ status: "rejected", message: "Invalid GitHub webhook signature" }, 401);
    }

    const event = context.req.header("x-github-event");
    const deliveryId = context.req.header("x-github-delivery") ?? "";

    if (event !== "issue_comment") {
      return context.json({ status: "ignored", message: `Ignored event: ${event ?? "unknown"}` });
    }

    if (deliveryId && processedDeliveries.has(deliveryId)) {
      return context.json({ status: "ignored", message: "Duplicate webhook delivery" });
    }

    const payload = JSON.parse(rawBody) as IssueCommentPayload;
    if (payload.action !== "created") {
      return context.json({ status: "ignored", message: `Ignored action: ${payload.action}` });
    }

    const sender = payload.comment.user ?? payload.sender;
    if (sender?.type === "Bot") {
      return context.json({ status: "ignored", message: "Ignored bot comment" });
    }

    const command = parseGovernanceCommand(payload.comment.body ?? "");
    if (!command) {
      return context.json({ status: "ignored", message: "No governance command found" });
    }

    const ref = {
      installationId: payload.installation?.id ?? 0,
      owner: payload.repository.owner.login,
      repo: payload.repository.name,
      issueNumber: payload.issue.number
    };

    if (command.error) {
      await deps.githubClient.createIssueComment(ref, renderErrorComment(command.error));
      return context.json({ status: "commented", message: command.error });
    }

    const allowed = canTriggerGovernance({
      author: sender?.login ?? "unknown",
      authorAssociation: payload.comment.author_association,
      allowedUsers: splitCsv(deps.env.GITHUB_TRIGGER_USERS),
      allowedAssociations: splitCsv(deps.env.GITHUB_TRIGGER_ASSOCIATIONS)
    });

    if (!allowed) {
      const message = "你没有权限触发 Issue 智能治理。默认仅维护者、成员或协作者可触发。";
      await deps.githubClient.createIssueComment(ref, renderErrorComment(message));
      return context.json({ status: "forbidden", message }, 403);
    }

    const { issue, candidateIssues } = await deps.githubClient.getIssueContext(ref);
    const repositoryPath = resolveRepositoryPath(
      payload.repository.full_name,
      deps.repositoryPathResolverOptions
    ).repositoryPath;
    const result = await deps.governanceService.governIssue(issue, {
      tasks: command.tasks,
      candidateIssues,
      mode: "comment_result",
      repositoryPath
    });
    const commentId = await deps.githubClient.createIssueComment(
      ref,
      renderGovernanceComment(result)
    );

    if (deliveryId) {
      processedDeliveries.add(deliveryId);
    }

    return context.json({ status: "commented", commentId });
  });

  return app;
}

export function verifyGitHubSignature(
  rawBody: string,
  secret: string,
  signatureHeader: string
): boolean {
  if (!signatureHeader.startsWith("sha256=")) {
    return false;
  }

  const expected = `sha256=${createHmac("sha256", secret).update(rawBody).digest("hex")}`;
  const expectedBuffer = Buffer.from(expected);
  const actualBuffer = Buffer.from(signatureHeader);

  return (
    expectedBuffer.length === actualBuffer.length && timingSafeEqual(expectedBuffer, actualBuffer)
  );
}

function splitCsv(value: string): string[] {
  return value
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);
}
