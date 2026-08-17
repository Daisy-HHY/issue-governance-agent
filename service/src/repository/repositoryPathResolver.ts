import path from "node:path";

export interface RepositoryPathResolverOptions {
  repositoryContextMap?: string;
  fallbackRepositoryPath?: string;
}

export interface RepositoryPathResolution {
  repository: string;
  repositoryPath?: string;
  source: "map" | "fallback" | "missing";
  message: string;
}

/**
 * Resolves a GitHub repository full name to the local source path used for CodeGraph context.
 */
export function resolveRepositoryPath(
  repoFullName: string,
  options: RepositoryPathResolverOptions = {}
): RepositoryPathResolution {
  const repository = repoFullName.trim();
  const mappedPath = parseRepositoryContextMap(options.repositoryContextMap).get(
    normalizeRepo(repository)
  );

  if (mappedPath) {
    return {
      repository,
      repositoryPath: path.resolve(mappedPath),
      source: "map",
      message: "Repository context path resolved from REPOSITORY_CONTEXT_MAP"
    };
  }

  if (options.fallbackRepositoryPath?.trim()) {
    return {
      repository,
      repositoryPath: path.resolve(options.fallbackRepositoryPath),
      source: "fallback",
      message: "Repository context path resolved from REPOSITORY_CONTEXT_PATH"
    };
  }

  return {
    repository,
    source: "missing",
    message: "Repository context path is not configured"
  };
}

function parseRepositoryContextMap(value = ""): Map<string, string> {
  const result = new Map<string, string>();

  for (const item of value.split(",")) {
    const separatorIndex = item.indexOf("=");
    if (separatorIndex <= 0) {
      continue;
    }

    const repo = item.slice(0, separatorIndex).trim();
    const repoPath = item.slice(separatorIndex + 1).trim();
    if (!repo || !repoPath) {
      continue;
    }

    result.set(normalizeRepo(repo), repoPath);
  }

  return result;
}

function normalizeRepo(value: string): string {
  return value.trim().toLowerCase();
}
