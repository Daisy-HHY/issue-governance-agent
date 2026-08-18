import { execFile } from "node:child_process";
import { readdir, readFile, stat, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

const PROJECT_PROFILE_FILE = "项目知识图谱.md";
const DEFAULT_TIMEOUT_MS = 10_000;
const DEFAULT_PROFILE_LIMIT = 6_000;
const DEFAULT_CODE_CONTEXT_LIMIT = 8_000;
const DEFAULT_FILE_LIST_LIMIT = 80;
const STOP_WORDS = new Set([
  "and",
  "are",
  "body",
  "bug",
  "can",
  "for",
  "from",
  "issue",
  "label",
  "labels",
  "not",
  "the",
  "this",
  "with",
  "your"
]);

export type RepositoryContextStatus = "used" | "missing" | "failed";
export type ContextSourceType =
  | "project_profile"
  | "codegraph"
  | "readme"
  | "source_file"
  | "file_list";

export interface ContextSource {
  type: ContextSourceType;
  status: RepositoryContextStatus;
  path?: string;
  query?: string;
  message?: string;
}

export interface CommandResult {
  exitCode: number | null;
  stdout: string;
  stderr: string;
  message?: string;
  errorCode?: string;
}

export interface CommandOptions {
  cwd: string;
  timeoutMs: number;
}

export type CommandRunner = (
  command: string,
  args: string[],
  options: CommandOptions
) => Promise<CommandResult>;

export interface EnsureCodeGraphResult {
  status: RepositoryContextStatus;
  action: "init" | "sync";
  repoPath: string;
  source: ContextSource;
  command: CommandResult | null;
}

export interface ProjectProfile {
  path: string;
  exists: boolean;
  content: string;
  updatedAt: string | null;
  truncated: boolean;
  source: ContextSource;
}

export interface IssueContextInput {
  title?: string;
  body?: string;
  labels?: string[];
}

export interface RelevantRepositoryContext {
  repoPath: string;
  query: string;
  keywords: string[];
  projectProfile: string;
  codeContext: string;
  fileList: string[];
  contextSources: ContextSource[];
  truncated: boolean;
}

export interface RepositoryContextOptions {
  runner?: CommandRunner;
  timeoutMs?: number;
  profileLimit?: number;
  codeContextLimit?: number;
  fileListLimit?: number;
}

interface ExecFileError extends Error {
  code?: number | string;
  stdout?: string | Buffer;
  stderr?: string | Buffer;
  killed?: boolean;
}

interface TruncatedText {
  text: string;
  truncated: boolean;
}

/**
 * Ensures CodeGraph has an index for the repository and returns a non-throwing status.
 */
export async function ensureCodeGraph(
  repoPath: string,
  options: RepositoryContextOptions = {}
): Promise<EnsureCodeGraphResult> {
  const resolvedRepoPath = path.resolve(repoPath);
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const runner = options.runner ?? runCommand;

  if (!(await isDirectory(resolvedRepoPath))) {
    const message = `Repository path does not exist: ${resolvedRepoPath}`;
    return {
      status: "failed",
      action: "init",
      repoPath: resolvedRepoPath,
      command: null,
      source: {
        type: "codegraph",
        status: "failed",
        path: resolvedRepoPath,
        message
      }
    };
  }

  const hasCodeGraphIndex = await isDirectory(path.join(resolvedRepoPath, ".codegraph"));
  const action = hasCodeGraphIndex ? "sync" : "init";
  let command = await runner("codegraph", [action], {
    cwd: resolvedRepoPath,
    timeoutMs
  });
  let finalAction: "init" | "sync" = action;

  if (action === "sync" && isCodeGraphNotInitialized(command)) {
    command = await runner("codegraph", ["init"], {
      cwd: resolvedRepoPath,
      timeoutMs
    });
    finalAction = "init";
  }

  const status = getCommandStatus(command);
  const message =
    status === "used"
      ? `CodeGraph ${finalAction} succeeded`
      : `CodeGraph ${finalAction} ${status}: ${command.message ?? command.stderr}`;

  return {
    status,
    action: finalAction,
    repoPath: resolvedRepoPath,
    command,
    source: {
      type: "codegraph",
      status,
      path: path.join(resolvedRepoPath, ".codegraph"),
      message
    }
  };
}

/**
 * Reads the project profile used as stable repository knowledge for issue governance.
 */
export async function loadProjectProfile(
  repoPath: string,
  options: RepositoryContextOptions = {}
): Promise<ProjectProfile> {
  const profilePath = path.join(path.resolve(repoPath), PROJECT_PROFILE_FILE);
  const profileLimit = options.profileLimit ?? DEFAULT_PROFILE_LIMIT;

  try {
    const [content, fileStat] = await Promise.all([readFile(profilePath, "utf8"), stat(profilePath)]);
    const truncated = truncateText(content, profileLimit);

    return {
      path: profilePath,
      exists: true,
      content: truncated.text,
      updatedAt: fileStat.mtime.toISOString(),
      truncated: truncated.truncated,
      source: {
        type: "project_profile",
        status: "used",
        path: profilePath,
        message: truncated.truncated ? `Profile truncated to ${profileLimit} characters` : "Profile loaded"
      }
    };
  } catch (error) {
    if (isMissingFile(error)) {
      return {
        path: profilePath,
        exists: false,
        content: "",
        updatedAt: null,
        truncated: false,
        source: {
          type: "project_profile",
          status: "missing",
          path: profilePath,
          message: "Project profile does not exist"
        }
      };
    }

    const message = error instanceof Error ? error.message : "Unknown read error";
    return {
      path: profilePath,
      exists: false,
      content: "",
      updatedAt: null,
      truncated: false,
      source: {
        type: "project_profile",
        status: "failed",
        path: profilePath,
        message
      }
    };
  }
}

/**
 * Refreshes the root project profile from current repository files.
 */
export async function refreshProjectProfile(repoPath: string): Promise<ProjectProfile> {
  const resolvedRepoPath = path.resolve(repoPath);
  const profilePath = path.join(resolvedRepoPath, PROJECT_PROFILE_FILE);
  const serviceReadme = await readOptional(path.join(resolvedRepoPath, "service", "README.md"));
  const files = await listRepositoryFiles(resolvedRepoPath, DEFAULT_FILE_LIST_LIMIT);
  const generatedAt = new Date().toISOString();

  const content = [
    "# 项目知识图谱",
    "",
    `更新时间：${generatedAt}`,
    "",
    "## 项目定位",
    "",
    "本项目是 GitHub Issue 智能治理服务原型，当前主体代码位于 [service](service/) 目录。第一版目标链路是 GitHub Issue 评论 `/issue-govern` 触发治理服务分析，再由 Bot 评论回当前 Issue。",
    "",
    "## 当前实现状态",
    "",
    serviceReadme
      ? "当前 `service/README.md` 记录的 P0 状态包括 Node.js / TypeScript 项目骨架、环境变量模板、治理结果 Schema 和 Schema 单元测试样例。"
      : "当前未找到 `service/README.md`，项目画像仅基于文件结构生成。",
    "",
    "## 技术栈",
    "",
    "- Node.js / TypeScript",
    "- Hono 与 `@hono/node-server`",
    "- Zod Schema",
    "- Vitest / ESLint",
    "- GitHub App 相关 Octokit 依赖",
    "",
    "## 目录与关键文件",
    "",
    "| 用途 | 可点击链接 | 说明 |",
    "|---|---|---|",
    "| 服务入口 | [index.ts](service/src/index.ts) | Hono 服务启动和 `/health` 健康检查 |",
    "| 环境变量 | [env.ts](service/src/config/env.ts) | GitHub、UUMIT、OpenAI 与日志配置校验 |",
    "| 治理 Schema | [governanceSchemas.ts](service/src/schemas/governanceSchemas.ts) | Issue、治理结果、UUMIT 响应结构定义 |",
    "| Schema 测试 | [governanceSchemas.test.ts](service/test/governanceSchemas.test.ts) | 当前 Schema 行为测试 |",
    "| 上下文模块 | [repositoryContext.ts](service/src/repository/repositoryContext.ts) | CodeGraph 初始化、项目画像读取和 Issue 相关上下文查询 |",
    "",
    "## GitHub Issue 治理目标链路",
    "",
    "```text",
    "GitHub Issue 评论 /issue-govern",
    "  -> GitHub App Webhook",
    "  -> IssueGovernanceService",
    "  -> RepositoryContext 查询仓库上下文",
    "  -> Bot 评论回当前 Issue",
    "```",
    "",
    "## 现有 Schema 能力",
    "",
    "- 原始 Issue、评论、标准化 Issue。",
    "- Issue 分类、去重、澄清、任务拆分、风险报告。",
    "- 治理请求、治理响应和 UUMIT 能力响应。",
    "",
    "## 后续待实现模块",
    "",
    "- GitHub Webhook 接收与 `/issue-govern` 指令解析。",
    "- `IssueGovernanceService` 治理编排。",
    "- GitHub Issue 获取、评论回写与幂等处理。",
    "- OpenAI / UUMIT 模型调用与结果格式化。",
    "",
    "## 验证命令",
    "",
    "在 [service](service/) 目录执行：",
    "",
    "```powershell",
    "npm test",
    "npm run typecheck",
    "npm run lint",
    "```",
    "",
    "## 风险与边界",
    "",
    "- 根目录 [ARCHITECTURE.md](ARCHITECTURE.md) 当前内容不属于本项目，治理上下文不应默认读取它。",
    "- CodeGraph 是代码定位工具，不是完整调用关系真相；需要穷尽影响面时仍要用文本搜索复核。",
    "- 当前项目未安装 `node_modules` 时，不默认安装依赖，测试执行会受阻。",
    "",
    "## 当前文件概览",
    "",
    ...files.map((file) => `- [${path.basename(file)}](${toMarkdownPath(file)})`),
    ""
  ].join(os.EOL);

  await writeFile(profilePath, content, "utf8");
  return loadProjectProfile(resolvedRepoPath);
}

/**
 * Builds the repository context block for a single issue governance request.
 */
export async function queryRelevantContext(
  repoPath: string,
  issue: IssueContextInput | string,
  options: RepositoryContextOptions = {}
): Promise<RelevantRepositoryContext> {
  const resolvedRepoPath = path.resolve(repoPath);
  const profile = await loadProjectProfile(resolvedRepoPath, options);
  const codeGraph = await ensureCodeGraph(resolvedRepoPath, options);
  const keywords = extractIssueKeywords(issue);
  const query = keywords.join(" ");
  const codeContextLimit = options.codeContextLimit ?? DEFAULT_CODE_CONTEXT_LIMIT;
  const fileListLimit = options.fileListLimit ?? DEFAULT_FILE_LIST_LIMIT;
  const contextSources = [profile.source, codeGraph.source];
  const fileList = await listRepositoryFiles(resolvedRepoPath, fileListLimit);
  contextSources.push({
    type: "file_list",
    status: fileList.length > 0 ? "used" : "missing",
    path: resolvedRepoPath,
    message: fileList.length > 0 ? `Loaded ${fileList.length} repository files` : "No repository files found"
  });

  let codeContext = "";
  let codeContextTruncated = false;

  if (codeGraph.status === "used") {
    const runner = options.runner ?? runCommand;
    const command = await runner("codegraph", ["explore", query], {
      cwd: resolvedRepoPath,
      timeoutMs: options.timeoutMs ?? DEFAULT_TIMEOUT_MS
    });
    const status = getCommandStatus(command);
    const truncated = truncateText(command.stdout, codeContextLimit);
    codeContext = status === "used" ? truncated.text : "";
    codeContextTruncated = truncated.truncated;
    contextSources.push({
      type: "codegraph",
      status,
      path: resolvedRepoPath,
      query,
      message:
        status === "used"
          ? codeContextTruncated
            ? `CodeGraph context truncated to ${codeContextLimit} characters`
            : "CodeGraph context loaded"
          : command.message ?? command.stderr
    });
  }

  return {
    repoPath: resolvedRepoPath,
    query,
    keywords,
    projectProfile: profile.content,
    codeContext,
    fileList,
    contextSources,
    truncated: profile.truncated || codeContextTruncated
  };
}

/**
 * Extracts safe search keywords from an issue title, body and labels.
 */
export function extractIssueKeywords(issue: IssueContextInput | string, limit = 20): string[] {
  const rawText =
    typeof issue === "string"
      ? issue
      : [issue.title, issue.body, ...(issue.labels ?? [])].filter(Boolean).join(" ");
  const text = rawText.replace(/^\/issue-govern\b.*$/gim, " ");
  const fileMatches = text.match(/[A-Za-z0-9_./-]+\.[A-Za-z0-9]{1,8}/g) ?? [];
  const wordMatches = text.match(/[\p{L}\p{N}_:/-]{3,}/gu) ?? [];
  const keywords = unique(
    [...fileMatches, ...wordMatches]
      .map((word) => word.replace(/^[./-]+|[./-]+$/g, ""))
      .filter((word) => word.length >= 3)
      .filter((word) => !STOP_WORDS.has(word.toLowerCase()))
      .filter((word) => !word.startsWith("/issue-govern"))
      .map((word) => word.slice(0, 80))
  ).slice(0, limit);

  return keywords.length > 0 ? keywords : ["project", "overview", "governance"];
}

async function runCommand(
  command: string,
  args: string[],
  options: CommandOptions
): Promise<CommandResult> {
  try {
    const resolvedCommand =
      process.platform === "win32" ? await resolveWindowsCommand(command, options.cwd) : command;
    const execCommand = process.platform === "win32" ? process.env.ComSpec ?? "cmd.exe" : resolvedCommand;
    const execArgs =
      process.platform === "win32"
        ? ["/d", "/s", "/c", quoteWindowsCommandLine([resolvedCommand, ...args])]
        : args;
    const { stdout, stderr } = await execFileAsync(execCommand, execArgs, {
      cwd: options.cwd,
      encoding: "utf8",
      maxBuffer: 1024 * 1024,
      timeout: options.timeoutMs,
      windowsVerbatimArguments: process.platform === "win32",
      windowsHide: true
    });

    return {
      exitCode: 0,
      stdout: String(stdout),
      stderr: String(stderr)
    };
  } catch (caught) {
    const error = caught as ExecFileError;
    return {
      exitCode: typeof error.code === "number" ? error.code : null,
      stdout: bufferToString(error.stdout),
      stderr: bufferToString(error.stderr),
      message: error.killed ? `Command timed out after ${options.timeoutMs}ms` : error.message,
      errorCode: typeof error.code === "string" ? error.code : undefined
    };
  }
}

async function resolveWindowsCommand(command: string, cwd: string): Promise<string> {
  if (path.isAbsolute(command)) {
    return command;
  }

  const extensions = path.extname(command) ? [""] : [".cmd", ".exe", ".bat", ""];
  const searchPaths = [cwd, ...(process.env.PATH ?? "").split(path.delimiter)].filter(Boolean);

  for (const searchPath of searchPaths) {
    for (const extension of extensions) {
      const candidate = path.join(searchPath, `${command}${extension}`);
      try {
        if ((await stat(candidate)).isFile()) {
          return candidate;
        }
      } catch {
        continue;
      }
    }
  }

  return command;
}

function getCommandStatus(command: CommandResult): RepositoryContextStatus {
  const message = [command.message, command.stderr].filter(Boolean).join(" ").toLowerCase();

  if (command.exitCode === 0) {
    return "used";
  }

  if (
    command.errorCode === "ENOENT" ||
    message.includes("not recognized") ||
    message.includes("command not found")
  ) {
    return "missing";
  }

  return "failed";
}

function isCodeGraphNotInitialized(command: CommandResult): boolean {
  const message = [command.message, command.stderr, command.stdout].filter(Boolean).join(" ");
  return command.exitCode !== 0 && /codegraph not initialized/i.test(message);
}

async function listRepositoryFiles(repoPath: string, limit: number): Promise<string[]> {
  const result: string[] = [];
  await collectFiles(repoPath, repoPath, result, limit);
  return result;
}

async function collectFiles(
  rootPath: string,
  currentPath: string,
  result: string[],
  limit: number
): Promise<void> {
  if (result.length >= limit || shouldSkipPath(currentPath)) {
    return;
  }

  let entries;
  try {
    entries = await readdir(currentPath, { withFileTypes: true });
  } catch {
    return;
  }

  for (const entry of entries) {
    if (result.length >= limit) {
      return;
    }

    const entryPath = path.join(currentPath, entry.name);
    if (shouldSkipPath(entryPath)) {
      continue;
    }

    if (entry.isDirectory()) {
      await collectFiles(rootPath, entryPath, result, limit);
    } else if (entry.isFile()) {
      result.push(toMarkdownPath(path.relative(rootPath, entryPath)));
    }
  }
}

function shouldSkipPath(filePath: string): boolean {
  const segments = filePath.split(path.sep);
  return segments.some((segment) =>
    [".git", ".codegraph", "dist", "node_modules", ".idea"].includes(segment)
  );
}

async function readOptional(filePath: string): Promise<string> {
  try {
    return await readFile(filePath, "utf8");
  } catch {
    return "";
  }
}

async function isDirectory(filePath: string): Promise<boolean> {
  try {
    return (await stat(filePath)).isDirectory();
  } catch {
    return false;
  }
}

function isMissingFile(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    (error as { code?: string }).code === "ENOENT"
  );
}

function truncateText(value: string, limit: number): TruncatedText {
  if (value.length <= limit) {
    return {
      text: value,
      truncated: false
    };
  }

  return {
    text: `${value.slice(0, limit)}\n\n[内容已截断，原始长度 ${value.length} 字符]`,
    truncated: true
  };
}

function unique(values: string[]): string[] {
  const seen = new Set<string>();
  const result: string[] = [];

  for (const value of values) {
    if (!seen.has(value)) {
      seen.add(value);
      result.push(value);
    }
  }

  return result;
}

function bufferToString(value: string | Buffer | undefined): string {
  return value === undefined ? "" : String(value);
}

function toMarkdownPath(filePath: string): string {
  return filePath.split(path.sep).join("/");
}

function quoteWindowsCommandLine(parts: string[]): string {
  const quotedParts = parts.map((part) => `"${part.replace(/(["^&|<>%])/g, "^$1")}"`).join(" ");
  return `"${quotedParts}"`;
}
