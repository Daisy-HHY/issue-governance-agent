import { promises as fs } from "node:fs";
import path from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";

export interface RepositoryPathResolverOptions {
  repositoryContextMap?: string;
  fallbackRepositoryPath?: string;
  repositoryContextRoot?: string;
  autoClone?: boolean;
  refresh?: "never" | "ttl" | "always";
  refreshTtlSeconds?: number;
  cloneTokenProvider?: (repoFullName: string) => Promise<string>;
  cloneCommandRunner?: CloneCommandRunner;
  cloneTimeoutMs?: number;
}

export interface RepositoryPathResolution {
  repository: string;
  repositoryPath?: string;
  source: "map" | "clone" | "fallback" | "missing" | "failed";
  message: string;
}

export interface CloneCommandOptions {
  cwd: string;
  timeoutMs: number;
  env?: NodeJS.ProcessEnv;
}

export interface CloneCommandResult {
  exitCode: number;
  stdout: string;
  stderr: string;
}

export type CloneCommandRunner = (
  command: string,
  args: string[],
  options: CloneCommandOptions
) => Promise<CloneCommandResult>;

const execFileAsync = promisify(execFile);
const DEFAULT_CLONE_TIMEOUT_MS = 120_000;
const cloneLocks = new Map<string, Promise<RepositoryPathResolution>>();

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

/**
 * Resolves repository context and optionally clones the current GitHub repository on demand.
 */
export async function resolveRepositoryPathForContext(
  repoFullName: string,
  options: RepositoryPathResolverOptions = {}
): Promise<RepositoryPathResolution> {
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

  if (options.autoClone && options.repositoryContextRoot?.trim()) {
    const cloned = await resolveClonedRepositoryPath(repository, options);
    if (cloned.repositoryPath) {
      return cloned;
    }

    if (!options.fallbackRepositoryPath?.trim()) {
      return cloned;
    }
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

async function resolveClonedRepositoryPath(
  repoFullName: string,
  options: RepositoryPathResolverOptions
): Promise<RepositoryPathResolution> {
  const repository = repoFullName.trim();
  const repo = parseRepoFullName(repository);
  const rootPath = path.resolve(options.repositoryContextRoot!);
  const targetPath = path.resolve(
    rootPath,
    sanitizePathSegment(repo.owner),
    sanitizePathSegment(repo.repo)
  );

  if (await isDirectory(targetPath)) {
    const refreshMessage = await refreshClonedRepository(repository, targetPath, options);
    return {
      repository,
      repositoryPath: targetPath,
      source: "clone",
      message: [
        "Repository context path resolved from auto-clone cache",
        refreshMessage
      ].filter(Boolean).join("; ")
    };
  }

  const existingLock = cloneLocks.get(targetPath);
  if (existingLock) {
    return existingLock;
  }

  const cloneTask = cloneRepository(repository, rootPath, targetPath, options).finally(() => {
    cloneLocks.delete(targetPath);
  });
  cloneLocks.set(targetPath, cloneTask);

  return cloneTask;
}

async function refreshClonedRepository(
  repoFullName: string,
  targetPath: string,
  options: RepositoryPathResolverOptions
): Promise<string> {
  const refresh = options.refresh ?? "never";
  if (refresh === "never" || !(await shouldRefreshRepository(targetPath, refresh, options))) {
    return "";
  }

  try {
    const token = options.cloneTokenProvider ? await options.cloneTokenProvider(repoFullName) : "";
    const args = [
      ...(token ? ["-c", `http.extraheader=${createGitAuthHeader(token)}`] : []),
      "pull",
      "--ff-only",
      "--depth",
      "1"
    ];
    const runner = options.cloneCommandRunner ?? runCloneCommand;
    const result = await runner("git", args, {
      cwd: targetPath,
      timeoutMs: options.cloneTimeoutMs ?? DEFAULT_CLONE_TIMEOUT_MS,
      env: {
        ...process.env,
        GIT_TERMINAL_PROMPT: "0",
        GCM_INTERACTIVE: "Never"
      }
    });

    if (result.exitCode !== 0) {
      return `Repository refresh failed: ${sanitizeCloneFailure(result.stderr || result.stdout)}`;
    }

    return "Repository cache refreshed";
  } catch (cause) {
    const message = cause instanceof Error ? cause.message : "Repository refresh failed";
    return `Repository refresh failed: ${sanitizeCloneFailure(message)}`;
  }
}

async function shouldRefreshRepository(
  targetPath: string,
  refresh: "never" | "ttl" | "always",
  options: RepositoryPathResolverOptions
): Promise<boolean> {
  if (refresh === "always") {
    return true;
  }

  if (refresh !== "ttl") {
    return false;
  }

  const ttlMs = (options.refreshTtlSeconds ?? 300) * 1000;
  if (ttlMs <= 0) {
    return true;
  }

  try {
    const fetchHead = await fs.stat(path.join(targetPath, ".git", "FETCH_HEAD"));
    return Date.now() - fetchHead.mtimeMs > ttlMs;
  } catch {
    return true;
  }
}

async function cloneRepository(
  repoFullName: string,
  rootPath: string,
  targetPath: string,
  options: RepositoryPathResolverOptions
): Promise<RepositoryPathResolution> {
  try {
    await fs.mkdir(path.dirname(targetPath), { recursive: true });

    const repo = parseRepoFullName(repoFullName);
    const token = options.cloneTokenProvider ? await options.cloneTokenProvider(repoFullName) : "";
    const args = [
      ...(token ? ["-c", `http.extraheader=${createGitAuthHeader(token)}`] : []),
      "clone",
      "--depth",
      "1",
      `https://github.com/${repo.owner}/${repo.repo}.git`,
      targetPath
    ];
    const runner = options.cloneCommandRunner ?? runCloneCommand;
    const result = await runner("git", args, {
      cwd: rootPath,
      timeoutMs: options.cloneTimeoutMs ?? DEFAULT_CLONE_TIMEOUT_MS,
      env: {
        ...process.env,
        GIT_TERMINAL_PROMPT: "0",
        GCM_INTERACTIVE: "Never"
      }
    });

    if (result.exitCode !== 0) {
      return {
        repository: repoFullName,
        source: "failed",
        message: sanitizeCloneFailure(
          result.stderr || result.stdout || "Repository auto clone failed"
        )
      };
    }

    return {
      repository: repoFullName,
      repositoryPath: targetPath,
      source: "clone",
      message: "Repository context path resolved from auto clone"
    };
  } catch (cause) {
    const message = cause instanceof Error ? cause.message : "Repository auto clone failed";
    return {
      repository: repoFullName,
      source: "failed",
      message: sanitizeCloneFailure(message)
    };
  }
}

async function runCloneCommand(
  command: string,
  args: string[],
  options: CloneCommandOptions
): Promise<CloneCommandResult> {
  try {
    const result = await execFileAsync(command, args, {
      cwd: options.cwd,
      timeout: options.timeoutMs,
      env: options.env,
      windowsHide: true
    });

    return {
      exitCode: 0,
      stdout: result.stdout,
      stderr: result.stderr
    };
  } catch (cause) {
    const error = cause as {
      code?: number;
      stdout?: string;
      stderr?: string;
      message?: string;
    };

    return {
      exitCode: typeof error.code === "number" ? error.code : 1,
      stdout: error.stdout ?? "",
      stderr: error.stderr ?? error.message ?? ""
    };
  }
}

async function isDirectory(value: string): Promise<boolean> {
  try {
    return (await fs.stat(value)).isDirectory();
  } catch {
    return false;
  }
}

function parseRepoFullName(repoFullName: string): { owner: string; repo: string } {
  const [owner, repo] = repoFullName.split("/");

  if (!owner || !repo) {
    throw new Error(`Invalid GitHub repository: ${repoFullName}`);
  }

  return { owner, repo };
}

function sanitizePathSegment(value: string): string {
  return Array.from(value)
    .map((char) => {
      const charCode = char.charCodeAt(0);
      return charCode <= 31 || '<>:"/\\|?*'.includes(char) ? "-" : char;
    })
    .join("");
}

function createGitAuthHeader(token: string): string {
  return `AUTHORIZATION: basic ${Buffer.from(`x-access-token:${token}`).toString("base64")}`;
}

function sanitizeCloneFailure(message: string): string {
  return message
    .replace(/(AUTHORIZATION:\s*bearer\s+)[^\s]+/gi, "$1[REDACTED]")
    .replace(/(AUTHORIZATION:\s*basic\s+)[^\s]+/gi, "$1[REDACTED]")
    .trim();
}
