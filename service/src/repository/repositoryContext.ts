import { execFile, spawn } from "node:child_process";
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
export type RepositoryContextProviderName = "auto" | "skill" | "mcp" | "cli";
export type ResolvedRepositoryContextProvider = "skill" | "mcp" | "cli" | "filesystem" | "none";
export type ContextSourceType =
  | "project_profile"
  | "codegraph"
  | "codegraph_mcp"
  | "codegraph_skill"
  | "readme"
  | "source_file"
  | "file_list";

export interface ContextSource {
  type: ContextSourceType;
  status: RepositoryContextStatus;
  path?: string;
  query?: string;
  message?: string;
  provider?: ResolvedRepositoryContextProvider;
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
  provider: ResolvedRepositoryContextProvider;
  projectProfile: string;
  codeContext: string;
  fileList: string[];
  matchedFiles: string[];
  warnings: string[];
  contextSources: ContextSource[];
  truncated: boolean;
}

export interface RepositoryContextOptions {
  runner?: CommandRunner;
  provider?: RepositoryContextProviderName;
  skillEndpoint?: string;
  skillRequester?: CodeGraphSkillRequester;
  mcpCommand?: string;
  mcpArgs?: string[];
  mcpRequester?: CodeGraphMcpRequester;
  mcpMaxFiles?: number;
  timeoutMs?: number;
  profileLimit?: number;
  codeContextLimit?: number;
  fileListLimit?: number;
}

export interface CodeGraphSkillRequest {
  repoPath: string;
  query: string;
  issue: IssueContextInput | string;
  codeContextLimit: number;
}

export interface CodeGraphSkillResponse {
  codeContext?: string;
  matchedFiles?: string[];
  warnings?: string[];
}

export type CodeGraphSkillRequester = (
  endpoint: string,
  request: CodeGraphSkillRequest,
  timeoutMs: number
) => Promise<CodeGraphSkillResponse>;

export interface CodeGraphMcpRequest {
  repoPath: string;
  query: string;
  codeContextLimit: number;
  maxFiles: number;
}

export interface CodeGraphMcpResponse {
  codeContext?: string;
  warnings?: string[];
}

export type CodeGraphMcpRequester = (
  request: CodeGraphMcpRequest,
  options: RepositoryContextOptions
) => Promise<CodeGraphMcpResponse>;

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

interface JsonRpcError {
  code?: number;
  message?: string;
}

interface JsonRpcResponse {
  jsonrpc?: string;
  id?: number | string | null;
  result?: unknown;
  error?: JsonRpcError;
}

interface McpTextContent {
  type?: string;
  text?: string;
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
  const keywords = extractIssueKeywords(issue);
  const query = keywords.join(" ");
  const codeContextLimit = options.codeContextLimit ?? DEFAULT_CODE_CONTEXT_LIMIT;
  const fileListLimit = options.fileListLimit ?? DEFAULT_FILE_LIST_LIMIT;
  const contextSources = [profile.source];
  const fileList = await listRepositoryFiles(resolvedRepoPath, fileListLimit);
  const warnings: string[] = [];
  contextSources.push({
    type: "file_list",
    status: fileList.length > 0 ? "used" : "missing",
    path: resolvedRepoPath,
    provider: "filesystem",
    message: fileList.length > 0 ? `Loaded ${fileList.length} repository files` : "No repository files found"
  });

  const provider = options.provider ?? "auto";
  const skillEndpoint = options.skillEndpoint?.trim();
  const shouldUseSkill = provider === "skill" || (provider === "auto" && skillEndpoint);
  const shouldUseMcp = provider === "mcp" || provider === "auto";
  const shouldUseCli = provider === "cli" || provider === "auto";

  if (shouldUseSkill) {
    if (!skillEndpoint) {
      const message = "CodeGraph skill provider is not configured";
      warnings.push(message);
      contextSources.push({
        type: "codegraph_skill",
        status: "failed",
        path: resolvedRepoPath,
        query,
        provider: "skill",
        message
      });

      return buildRepositoryContextResult({
        resolvedRepoPath,
        query,
        keywords,
        profile,
        fileList,
        provider: "none",
        codeContext: "",
        matchedFiles: inferMatchedFiles(fileList, "", keywords),
        warnings,
        contextSources,
        codeContextTruncated: false
      });
    }

    const skillContext = await queryCodeGraphSkill(
      skillEndpoint,
      {
        repoPath: resolvedRepoPath,
        query,
        issue,
        codeContextLimit
      },
      options
    );
    contextSources.push(skillContext.source);
    warnings.push(...skillContext.warnings);

    return buildRepositoryContextResult({
      resolvedRepoPath,
      query,
      keywords,
      profile,
      fileList,
      provider: "skill",
      codeContext: skillContext.codeContext,
      matchedFiles:
        skillContext.matchedFiles.length > 0
          ? skillContext.matchedFiles
          : inferMatchedFiles(fileList, skillContext.codeContext, keywords),
      warnings,
      contextSources,
      codeContextTruncated: false
    });
  }

  if (provider === "auto" && !skillEndpoint) {
    warnings.push("CodeGraph skill provider is unavailable; MCP provider will be used before CLI fallback.");
  }

  if (shouldUseMcp) {
    const mcpContext = await queryMcpCodeGraphContext(
      resolvedRepoPath,
      query,
      codeContextLimit,
      options
    );
    contextSources.push(...mcpContext.sources);
    warnings.push(...mcpContext.warnings);

    if (provider === "mcp" || mcpContext.provider === "mcp") {
      return buildRepositoryContextResult({
        resolvedRepoPath,
        query,
        keywords,
        profile,
        fileList,
        provider: mcpContext.provider,
        codeContext: mcpContext.codeContext,
        matchedFiles: inferMatchedFiles(fileList, mcpContext.codeContext, keywords),
        warnings,
        contextSources,
        codeContextTruncated: mcpContext.truncated
      });
    }

    warnings.push("CodeGraph MCP provider failed; CLI fallback was used.");
  }

  if (shouldUseCli) {
    const cliContext = await queryCliCodeGraphContext(
      resolvedRepoPath,
      query,
      codeContextLimit,
      options
    );
    contextSources.push(...cliContext.sources);
    warnings.push(...cliContext.warnings);
    return buildRepositoryContextResult({
      resolvedRepoPath,
      query,
      keywords,
      profile,
      fileList,
      provider: cliContext.provider,
      codeContext: cliContext.codeContext,
      matchedFiles: inferMatchedFiles(fileList, cliContext.codeContext, keywords),
      warnings,
      contextSources,
      codeContextTruncated: cliContext.truncated
    });
  }

  warnings.push("No repository context provider was available.");
  return buildRepositoryContextResult({
    resolvedRepoPath,
    query,
    keywords,
    profile,
    fileList,
    provider: "filesystem",
    codeContext: "",
    matchedFiles: inferMatchedFiles(fileList, "", keywords),
    warnings,
    contextSources,
    codeContextTruncated: false
  });
}

async function queryMcpCodeGraphContext(
  resolvedRepoPath: string,
  query: string,
  codeContextLimit: number,
  options: RepositoryContextOptions
): Promise<{
  provider: ResolvedRepositoryContextProvider;
  codeContext: string;
  sources: ContextSource[];
  warnings: string[];
  truncated: boolean;
}> {
  const codeGraph = await ensureCodeGraph(resolvedRepoPath, options);
  const sources = [codeGraph.source];
  const warnings = ["CodeGraph MCP uses tree-sitter approximation; use text search for exhaustive impact checks."];
  let codeContext = "";
  let codeContextTruncated = false;

  if (codeGraph.status !== "used") {
    return {
      provider: "filesystem",
      codeContext,
      sources,
      warnings,
      truncated: codeContextTruncated
    };
  }

  try {
    const requester = options.mcpRequester ?? requestCodeGraphMcpContext;
    const response = await requester(
      {
        repoPath: resolvedRepoPath,
        query,
        codeContextLimit,
        maxFiles: options.mcpMaxFiles ?? 8
      },
      options
    );
    const truncated = truncateText(response.codeContext ?? "", codeContextLimit);
    codeContext = truncated.text;
    codeContextTruncated = truncated.truncated;
    sources.push({
      type: "codegraph_mcp",
      status: "used",
      path: resolvedRepoPath,
      query,
      provider: "mcp",
      message: codeContextTruncated
        ? `CodeGraph MCP context truncated to ${codeContextLimit} characters`
        : "CodeGraph MCP context loaded"
    });
    warnings.push(...(response.warnings ?? []));

    return {
      provider: "mcp",
      codeContext,
      sources,
      warnings,
      truncated: codeContextTruncated
    };
  } catch (cause) {
    const message = cause instanceof Error ? cause.message : "CodeGraph MCP request failed";
    sources.push({
      type: "codegraph_mcp",
      status: "failed",
      path: resolvedRepoPath,
      query,
      provider: "mcp",
      message
    });
    warnings.push(message);

    return {
      provider: "filesystem",
      codeContext,
      sources,
      warnings,
      truncated: codeContextTruncated
    };
  }
}

async function queryCliCodeGraphContext(
  resolvedRepoPath: string,
  query: string,
  codeContextLimit: number,
  options: RepositoryContextOptions
): Promise<{
  provider: ResolvedRepositoryContextProvider;
  codeContext: string;
  sources: ContextSource[];
  warnings: string[];
  truncated: boolean;
}> {
  const codeGraph = await ensureCodeGraph(resolvedRepoPath, options);
  const sources = [codeGraph.source];
  const warnings = ["CodeGraph uses tree-sitter approximation; use text search for exhaustive impact checks."];
  let codeContext = "";
  let codeContextTruncated = false;

  if (codeGraph.status !== "used") {
    return {
      provider: "filesystem",
      codeContext,
      sources,
      warnings,
      truncated: codeContextTruncated
    };
  }

  const runner = options.runner ?? runCommand;
  const command = await runner("codegraph", ["explore", query], {
    cwd: resolvedRepoPath,
    timeoutMs: options.timeoutMs ?? DEFAULT_TIMEOUT_MS
  });
  const status = getCommandStatus(command);
  const truncated = truncateText(command.stdout, codeContextLimit);
  codeContext = status === "used" ? truncated.text : "";
  codeContextTruncated = truncated.truncated;
  sources.push({
    type: "codegraph",
    status,
    path: resolvedRepoPath,
    query,
    provider: "cli",
    message:
      status === "used"
        ? codeContextTruncated
          ? `CodeGraph CLI context truncated to ${codeContextLimit} characters`
          : "CodeGraph CLI context loaded"
        : command.message ?? command.stderr
  });

  return {
    provider: status === "used" ? "cli" : "filesystem",
    codeContext,
    sources,
    warnings,
    truncated: codeContextTruncated
  };
}

async function queryCodeGraphSkill(
  endpoint: string,
  request: CodeGraphSkillRequest,
  options: RepositoryContextOptions
): Promise<{
  codeContext: string;
  matchedFiles: string[];
  warnings: string[];
  source: ContextSource;
}> {
  try {
    const requester = options.skillRequester ?? requestCodeGraphSkillContext;
    const response = await requester(endpoint, request, options.timeoutMs ?? DEFAULT_TIMEOUT_MS);
    return {
      codeContext: response.codeContext ?? "",
      matchedFiles: response.matchedFiles ?? [],
      warnings: [
        "CodeGraph skill is an approximate code graph; use text search for exhaustive impact checks.",
        ...(response.warnings ?? [])
      ],
      source: {
        type: "codegraph_skill",
        status: "used",
        path: request.repoPath,
        query: request.query,
        provider: "skill",
        message: "CodeGraph skill context loaded"
      }
    };
  } catch (cause) {
    const message = cause instanceof Error ? cause.message : "CodeGraph skill request failed";
    return {
      codeContext: "",
      matchedFiles: [],
      warnings: [message],
      source: {
        type: "codegraph_skill",
        status: "failed",
        path: request.repoPath,
        query: request.query,
        provider: "skill",
        message
      }
    };
  }
}

async function requestCodeGraphSkillContext(
  endpoint: string,
  request: CodeGraphSkillRequest,
  timeoutMs: number
): Promise<CodeGraphSkillResponse> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const response = await fetch(endpoint, {
      method: "POST",
      headers: {
        "content-type": "application/json"
      },
      body: JSON.stringify(request),
      signal: controller.signal
    });

    if (!response.ok) {
      throw new Error(`CodeGraph skill endpoint returned ${response.status}`);
    }

    return (await response.json()) as CodeGraphSkillResponse;
  } finally {
    clearTimeout(timeout);
  }
}

async function requestCodeGraphMcpContext(
  request: CodeGraphMcpRequest,
  options: RepositoryContextOptions
): Promise<CodeGraphMcpResponse> {
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const command = options.mcpCommand?.trim() || "codegraph";
  const args = options.mcpArgs?.length ? options.mcpArgs : ["serve", "--mcp"];
  const child = await spawnMcpServer(command, args, request.repoPath);
  let stdout = "";
  let stderr = "";
  let nextId = 1;
  const pending = new Map<number, (response: JsonRpcResponse) => void>();

  const cleanup = (): void => {
    child.stdin.end();
    if (!child.killed) {
      child.kill();
    }
  };

  const send = (method: string, params?: unknown): number => {
    const id = nextId++;
    child.stdin.write(`${JSON.stringify({ jsonrpc: "2.0", id, method, params })}\n`);
    return id;
  };
  const notify = (method: string, params?: unknown): void => {
    child.stdin.write(`${JSON.stringify({ jsonrpc: "2.0", method, params })}\n`);
  };
  const waitForResponse = (id: number): Promise<JsonRpcResponse> =>
    new Promise((resolve) => {
      pending.set(id, resolve);
    });

  child.stdout.on("data", (data: Buffer) => {
    stdout += data.toString("utf8");
    let newlineIndex = stdout.indexOf("\n");
    while (newlineIndex >= 0) {
      const line = stdout.slice(0, newlineIndex).trim();
      stdout = stdout.slice(newlineIndex + 1);
      if (line) {
        handleJsonRpcLine(line, pending);
      }
      newlineIndex = stdout.indexOf("\n");
    }
  });
  child.stderr.on("data", (data: Buffer) => {
    stderr += data.toString("utf8");
  });

  try {
    const initializeId = send("initialize", {
      protocolVersion: "2024-11-05",
      capabilities: {},
      clientInfo: {
        name: "issue-governance-agent",
        version: "0.1.0"
      }
    });
    const initialize = await withTimeout(waitForResponse(initializeId), timeoutMs, "CodeGraph MCP initialize timed out");
    throwIfJsonRpcError(initialize, "CodeGraph MCP initialize failed");
    notify("notifications/initialized", {});

    const toolCallId = send("tools/call", {
      name: "codegraph_explore",
      arguments: {
        query: request.query,
        projectPath: request.repoPath,
        maxFiles: request.maxFiles
      }
    });
    const toolCall = await withTimeout(waitForResponse(toolCallId), timeoutMs, "CodeGraph MCP tools/call timed out");
    throwIfJsonRpcError(toolCall, "CodeGraph MCP tools/call failed");

    return {
      codeContext: readMcpTextContent(toolCall.result),
      warnings: stderr.trim() ? [stderr.trim()] : []
    };
  } finally {
    cleanup();
  }
}

function buildRepositoryContextResult(input: {
  resolvedRepoPath: string;
  query: string;
  keywords: string[];
  profile: ProjectProfile;
  fileList: string[];
  provider: ResolvedRepositoryContextProvider;
  codeContext: string;
  matchedFiles: string[];
  warnings: string[];
  contextSources: ContextSource[];
  codeContextTruncated: boolean;
}): RelevantRepositoryContext {
  return {
    repoPath: input.resolvedRepoPath,
    query: input.query,
    keywords: input.keywords,
    provider: input.provider,
    projectProfile: input.profile.content,
    codeContext: input.codeContext,
    fileList: input.fileList,
    matchedFiles: input.matchedFiles,
    warnings: unique(input.warnings.filter(Boolean)),
    contextSources: input.contextSources,
    truncated: input.profile.truncated || input.codeContextTruncated
  };
}

function inferMatchedFiles(fileList: string[], codeContext: string, keywords: string[]): string[] {
  const loweredCodeContext = codeContext.toLowerCase();
  const loweredKeywords = keywords.map((keyword) => keyword.toLowerCase());
  const fromCodeContext = fileList.filter((filePath) =>
    loweredCodeContext.includes(filePath.toLowerCase())
  );
  const fromKeywords = fileList.filter((filePath) => {
    const loweredPath = filePath.toLowerCase();
    return loweredKeywords.some((keyword) => loweredPath.includes(keyword));
  });

  return unique([...fromCodeContext, ...fromKeywords]).slice(0, 10);
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

async function spawnMcpServer(command: string, args: string[], cwd: string) {
  if (process.platform !== "win32") {
    return spawn(command, args, {
      cwd,
      stdio: ["pipe", "pipe", "pipe"],
      windowsHide: true
    });
  }

  return spawn(
    process.env.ComSpec ?? "cmd.exe",
    ["/d", "/c", [command, ...args].map(quoteWindowsMcpArgument).join(" ")],
    {
      cwd,
      stdio: ["pipe", "pipe", "pipe"],
      windowsHide: true
    }
  );
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

function handleJsonRpcLine(line: string, pending: Map<number, (response: JsonRpcResponse) => void>): void {
  const message = JSON.parse(line) as JsonRpcResponse;
  if (typeof message.id !== "number") {
    return;
  }

  const resolve = pending.get(message.id);
  if (resolve) {
    pending.delete(message.id);
    resolve(message);
  }
}

function withTimeout<T>(promise: Promise<T>, timeoutMs: number, message: string): Promise<T> {
  let timer: NodeJS.Timeout;
  const timeout = new Promise<never>((_resolve, reject) => {
    timer = setTimeout(() => reject(new Error(message)), timeoutMs);
  });

  return Promise.race([promise, timeout]).finally(() => clearTimeout(timer));
}

function throwIfJsonRpcError(response: JsonRpcResponse, fallbackMessage: string): void {
  if (response.error) {
    throw new Error(response.error.message ?? fallbackMessage);
  }
}

function readMcpTextContent(result: unknown): string {
  if (!isRecord(result) || !Array.isArray(result.content)) {
    return "";
  }

  return result.content
    .map((item: unknown) => (isMcpTextContent(item) && item.type === "text" ? item.text ?? "" : ""))
    .filter(Boolean)
    .join("\n");
}

function isMcpTextContent(value: unknown): value is McpTextContent {
  return isRecord(value) && (value.type === undefined || typeof value.type === "string");
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
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

function quoteWindowsMcpArgument(part: string): string {
  if (/^[A-Za-z0-9_./:\\-]+$/.test(part)) {
    return part;
  }

  return `"${part.replace(/"/g, '\\"')}"`;
}
