import { Hono } from "hono";
import { governanceRequestSchema, governanceResponseSchema } from "../schemas/governanceSchemas.js";
import { renderGovernanceComment } from "../github/commentRenderer.js";
import { resolveRepositoryPath } from "../repository/repositoryPathResolver.js";
import type { AppEnv } from "../config/env.js";
import type { RepositoryPathResolverOptions } from "../repository/repositoryPathResolver.js";
import type { RepositoryIssueProvider } from "../services/githubClient.js";
import type { IssueGovernanceService } from "../services/issueGovernanceService.js";
import type { GovernanceRequest, UumitGovernanceResponse } from "../schemas/governanceSchemas.js";

const CAPABILITY = "github_issue_governance";
const RATE_LIMIT_WINDOW_MS = 60_000;
const RATE_LIMIT_MAX = 60;

export interface UumitRoutesDeps {
  env: AppEnv;
  governanceService: IssueGovernanceService;
  githubClient?: RepositoryIssueProvider;
  repositoryPathResolverOptions?: RepositoryPathResolverOptions;
  idempotencyStore?: Map<string, UumitGovernanceResponse>;
  rateLimitStore?: Map<string, number[]>;
}

/**
 * Creates the UUMIT capability HTTP API routes.
 */
export function createUumitCapabilityRoutes(deps: UumitRoutesDeps): Hono {
  const app = new Hono();
  const idempotencyStore = deps.idempotencyStore ?? new Map<string, UumitGovernanceResponse>();
  const rateLimitStore = deps.rateLimitStore ?? new Map<string, number[]>();

  app.post("/github/issues/govern", async (context) => {
    const startedAt = Date.now();
    const auth = context.req.header("authorization") ?? "";
    const apiKey = context.req.header("x-api-key") ?? auth.replace(/^Bearer\s+/i, "");
    const clientKey = context.req.header("x-forwarded-for") ?? "local";

    if (apiKey !== deps.env.UUMIT_API_KEY) {
      return context.json(
        failedResponse("unauthorized", "UNAUTHORIZED", "Invalid UUMIT API key"),
        401
      );
    }

    if (!consumeRateLimit(rateLimitStore, clientKey)) {
      return context.json(failedResponse("rate-limited", "RATE_LIMITED", "Too many requests"), 429);
    }

    const body = await context.req.json();
    const parsed = governanceRequestSchema.safeParse(body);
    if (!parsed.success) {
      return context.json(
        failedResponse("invalid-request", "INVALID_REQUEST", parsed.error.message),
        400
      );
    }

    const request = parsed.data;
    const requestId = request.requestId ?? `uumit-${Date.now()}`;
    const cachedResponse = idempotencyStore.get(requestId);

    if (cachedResponse) {
      return context.json(cachedResponse);
    }

    const resultJson = await governRequestIssues(deps, request);
    if (!resultJson) {
      const response = failedResponse(
        requestId,
        "GITHUB_CONTEXT_UNAVAILABLE",
        "UUMIT 请求缺少可用 GitHub App 上下文，无法真实拉取 Issue。"
      );
      response.repository = request.repo;
      return context.json(response, 424);
    }

    const resultMarkdown = renderGovernanceComment(resultJson);
    const response: UumitGovernanceResponse = {
      requestId,
      status: "succeeded",
      capability: CAPABILITY,
      repository: request.repo,
      resultMarkdown,
      resultJson,
      usage: {
        issueCount: resultJson.issues.length,
        inputTokens: 0,
        outputTokens: 0,
        durationMs: Date.now() - startedAt,
        billingUnit: request.issueRange ? "per_batch" : "per_issue"
      }
    };

    idempotencyStore.set(requestId, response);
    return context.json(response);
  });

  return app;
}

function failedResponse(
  requestId: string,
  errorCode: string,
  message: string
): UumitGovernanceResponse {
  return {
    requestId,
    status: "failed",
    capability: CAPABILITY,
    repository: "unknown",
    resultMarkdown: "",
    errorCode,
    message
  };
}

function consumeRateLimit(store: Map<string, number[]>, key: string): boolean {
  const now = Date.now();
  const recent = (store.get(key) ?? []).filter((time) => now - time < RATE_LIMIT_WINDOW_MS);

  if (recent.length >= RATE_LIMIT_MAX) {
    store.set(key, recent);
    return false;
  }

  recent.push(now);
  store.set(key, recent);
  return true;
}

async function governRequestIssues(
  deps: UumitRoutesDeps,
  request: GovernanceRequest
): Promise<NonNullable<UumitGovernanceResponse["resultJson"]> | null> {
  if (!deps.githubClient) {
    return null;
  }

  const repositoryPath = resolveRepositoryPath(
    request.repo,
    deps.repositoryPathResolverOptions
  ).repositoryPath;

  if (request.issueNumber !== undefined) {
    const { issue, candidateIssues } = await deps.githubClient.getIssueContextByRepository(
      request.repo,
      request.issueNumber
    );
    return deps.governanceService.governIssue(issue, {
      tasks: request.tasks,
      candidateIssues,
      mode: request.mode,
      repositoryPath
    });
  }

  if (!request.issueRange) {
    return null;
  }

  const requestIssues = await deps.githubClient.listIssuesForGovernance(
    request.repo,
    request.issueRange
  );
  const issueResponses = await Promise.all(
    requestIssues.map((issue) =>
      deps.governanceService.governIssue(issue, {
        tasks: request.tasks,
        candidateIssues: requestIssues.filter((candidate) => candidate.number !== issue.number),
        mode: request.mode,
        repositoryPath
      })
    )
  );
  const issues = issueResponses.flatMap((response) => response.issues);

  return governanceResponseSchema.parse({
    repository: request.repo,
    mode: request.mode,
    summary: {
      analyzedIssues: issues.length,
      duplicateGroups: issues.filter((issue) => issue.dedupe.isDuplicate).length,
      unclearIssues: issues.filter((issue) => issue.clarification.needed).length,
      highRiskIssues: issues.filter((issue) =>
        ["high", "critical"].includes(issue.riskReport.level)
      ).length,
      suggestedTasks: issues.reduce((total, issue) => total + issue.splitTasks.length, 0),
      testPoints: issues.reduce((total, issue) => total + issue.testPoints.length, 0)
    },
    issues
  });
}
