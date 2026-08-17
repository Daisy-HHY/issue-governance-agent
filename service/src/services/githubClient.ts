import { createSign } from "node:crypto";
import { Octokit } from "@octokit/rest";
import type { IssueState, RawIssue } from "../schemas/governanceSchemas.js";

export interface GitHubClientConfig {
  appId: string;
  privateKey: string;
}

export interface IssueRef {
  installationId: number;
  owner: string;
  repo: string;
  issueNumber: number;
}

export interface IssueRangeQuery {
  state?: IssueState;
  limit?: number;
  labels?: string[];
  since?: string | null;
}

export interface RepositoryIssueProvider {
  getIssueContextByRepository(
    repoFullName: string,
    issueNumber: number
  ): Promise<{ issue: RawIssue; candidateIssues: RawIssue[] }>;
  listIssuesForGovernance(repoFullName: string, range: IssueRangeQuery): Promise<RawIssue[]>;
}

interface GitHubIssue {
  number: number;
  title: string;
  body: string | null;
  state: "open" | "closed";
  user: { login: string } | null;
  labels: Array<string | { name?: string | null }>;
  assignees?: Array<{ login: string } | null> | null;
  milestone?: { title?: string | null } | null;
  created_at: string;
  updated_at: string;
}

interface GitHubComment {
  id: number;
  body?: string | null;
  user?: { login?: string | null } | null;
  created_at: string;
  updated_at?: string | null;
}

/**
 * Wraps the GitHub App calls needed by the issue governance MVP.
 */
export class GitHubClient {
  constructor(private readonly config: GitHubClientConfig) {}

  /**
   * Fetches an issue, its comments and recent open issues for duplicate candidates.
   */
  async getIssueContext(ref: IssueRef): Promise<{ issue: RawIssue; candidateIssues: RawIssue[] }> {
    const client = await this.createInstallationClient(ref.installationId);
    const [issueResponse, commentsResponse, candidatesResponse] = await Promise.all([
      client.issues.get({
        owner: ref.owner,
        repo: ref.repo,
        issue_number: ref.issueNumber
      }),
      client.issues.listComments({
        owner: ref.owner,
        repo: ref.repo,
        issue_number: ref.issueNumber,
        per_page: 50
      }),
      client.issues.listForRepo({
        owner: ref.owner,
        repo: ref.repo,
        state: "open",
        per_page: 50
      })
    ]);

    return {
      issue: toRawIssue(
        `${ref.owner}/${ref.repo}`,
        issueResponse.data as GitHubIssue,
        commentsResponse.data as GitHubComment[]
      ),
      candidateIssues: (candidatesResponse.data as GitHubIssue[])
        .filter((issue) => !("pull_request" in issue))
        .map((issue) => toRawIssue(`${ref.owner}/${ref.repo}`, issue, []))
    };
  }

  /**
   * Fetches a single issue context when only the repository full name is known.
   */
  async getIssueContextByRepository(
    repoFullName: string,
    issueNumber: number
  ): Promise<{ issue: RawIssue; candidateIssues: RawIssue[] }> {
    const repo = parseRepoFullName(repoFullName);
    const installationId = await this.getRepositoryInstallationId(repo.owner, repo.repo);

    return this.getIssueContext({
      installationId,
      owner: repo.owner,
      repo: repo.repo,
      issueNumber
    });
  }

  /**
   * Lists real GitHub issues for batch governance.
   */
  async listIssuesForGovernance(repoFullName: string, range: IssueRangeQuery): Promise<RawIssue[]> {
    const repo = parseRepoFullName(repoFullName);
    const installationId = await this.getRepositoryInstallationId(repo.owner, repo.repo);
    const client = await this.createInstallationClient(installationId);
    const response = await client.issues.listForRepo({
      owner: repo.owner,
      repo: repo.repo,
      state: range.state ?? "open",
      labels: range.labels?.join(",") || undefined,
      since: range.since ?? undefined,
      per_page: range.limit ?? 50
    });

    return (response.data as GitHubIssue[])
      .filter((issue) => !("pull_request" in issue))
      .slice(0, range.limit ?? 50)
      .map((issue) => toRawIssue(repoFullName, issue, []));
  }

  /**
   * Creates a bot comment on the current issue.
   */
  async createIssueComment(ref: IssueRef, body: string): Promise<number> {
    const client = await this.createInstallationClient(ref.installationId);
    const response = await client.issues.createComment({
      owner: ref.owner,
      repo: ref.repo,
      issue_number: ref.issueNumber,
      body
    });

    return response.data.id;
  }

  private async createInstallationClient(installationId: number): Promise<Octokit> {
    const jwt = createGitHubAppJwt(this.config.appId, this.config.privateKey);
    const appClient = new Octokit({ auth: jwt });
    const response = await appClient.request(
      "POST /app/installations/{installation_id}/access_tokens",
      {
        installation_id: installationId
      }
    );

    return new Octokit({ auth: response.data.token });
  }

  private async getRepositoryInstallationId(owner: string, repo: string): Promise<number> {
    const jwt = createGitHubAppJwt(this.config.appId, this.config.privateKey);
    const appClient = new Octokit({ auth: jwt });
    const response = await appClient.request("GET /repos/{owner}/{repo}/installation", {
      owner,
      repo
    });

    return response.data.id;
  }
}

function parseRepoFullName(repoFullName: string): { owner: string; repo: string } {
  const [owner, repo] = repoFullName.split("/");

  if (!owner || !repo) {
    throw new Error(`Invalid GitHub repository: ${repoFullName}`);
  }

  return { owner, repo };
}

function createGitHubAppJwt(appId: string, privateKey: string): string {
  const now = Math.floor(Date.now() / 1000);
  const header = base64Url(JSON.stringify({ alg: "RS256", typ: "JWT" }));
  const payload = base64Url(
    JSON.stringify({
      iat: now - 60,
      exp: now + 9 * 60,
      iss: appId
    })
  );
  const unsigned = `${header}.${payload}`;
  const signer = createSign("RSA-SHA256");
  signer.update(unsigned);
  signer.end();
  const normalizedKey = privateKey.replace(/\\n/g, "\n");
  const signature = signer.sign(normalizedKey).toString("base64url");

  return `${unsigned}.${signature}`;
}

function toRawIssue(repo: string, issue: GitHubIssue, comments: GitHubComment[]): RawIssue {
  return {
    repo,
    number: issue.number,
    title: issue.title,
    body: issue.body ?? "",
    labels: issue.labels.map((label) => (typeof label === "string" ? label : (label.name ?? ""))),
    state: issue.state,
    author: issue.user?.login ?? "unknown",
    assignees: (issue.assignees ?? []).map((assignee) => assignee?.login ?? "").filter(Boolean),
    milestone: issue.milestone?.title ?? undefined,
    comments: comments.map((comment) => ({
      id: comment.id,
      author: comment.user?.login ?? "unknown",
      body: comment.body ?? "",
      createdAt: comment.created_at,
      updatedAt: comment.updated_at ?? undefined
    })),
    createdAt: issue.created_at,
    updatedAt: issue.updated_at
  };
}

function base64Url(value: string): string {
  return Buffer.from(value).toString("base64url");
}
