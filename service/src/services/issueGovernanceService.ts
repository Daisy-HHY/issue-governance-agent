import { queryRelevantContext } from "../repository/repositoryContext.js";
import type {
  ContextSource,
  IssueContextInput,
  RelevantRepositoryContext
} from "../repository/repositoryContext.js";
import type { RawIssue } from "../schemas/governanceSchemas.js";

export interface IssueGovernanceServiceOptions {
  repositoryPath?: string;
}

export interface PreparedGovernanceInput {
  issue: RawIssue;
  repositoryContext: RelevantRepositoryContext | null;
  promptContext: string;
  contextSources: ContextSource[];
}

export type RepositoryContextLoader = (
  repoPath: string,
  issue: IssueContextInput
) => Promise<RelevantRepositoryContext>;

/**
 * Prepares issue governance input before model analysis.
 */
export class IssueGovernanceService {
  constructor(private readonly repositoryContextLoader: RepositoryContextLoader = queryRelevantContext) {}

  /**
   * Adds repository context when a local repository path is available.
   */
  async prepareInput(
    issue: RawIssue,
    options: IssueGovernanceServiceOptions = {}
  ): Promise<PreparedGovernanceInput> {
    const repositoryContext = options.repositoryPath
      ? await this.repositoryContextLoader(options.repositoryPath, {
          title: issue.title,
          body: issue.body,
          labels: issue.labels
        })
      : null;

    return {
      issue,
      repositoryContext,
      promptContext: buildPromptContext(issue, repositoryContext),
      contextSources: repositoryContext?.contextSources ?? []
    };
  }
}

/**
 * Builds the bounded prompt context used by the governance model.
 */
export function buildPromptContext(
  issue: RawIssue,
  repositoryContext: RelevantRepositoryContext | null
): string {
  const sections = [
    "# Issue",
    "",
    `Repository: ${issue.repo}`,
    `Issue: #${issue.number}`,
    `Title: ${issue.title}`,
    "",
    "## Rules",
    "",
    "- Do not invent files, APIs, issue relations or repository behavior not present in the context.",
    "- If context is insufficient, ask clarification questions instead of forcing a conclusion.",
    "- Risk and test suggestions should cite issue evidence or repository context when available."
  ];

  if (repositoryContext) {
    sections.push(
      "",
      "## Repository Profile",
      "",
      repositoryContext.projectProfile || "Project profile is missing.",
      "",
      "## Related Code Context",
      "",
      repositoryContext.codeContext || "CodeGraph context is unavailable.",
      "",
      "## Context Sources",
      "",
      ...repositoryContext.contextSources.map(formatContextSource)
    );
  }

  return sections.join("\n");
}

function formatContextSource(source: ContextSource): string {
  const details = [source.path, source.query, source.message].filter(Boolean).join(" | ");
  return `- ${source.type}: ${source.status}${details ? ` | ${details}` : ""}`;
}
