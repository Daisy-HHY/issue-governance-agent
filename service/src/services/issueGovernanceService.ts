import { queryRelevantContext } from "../repository/repositoryContext.js";
import { governanceResponseSchema, governanceResultSchema } from "../schemas/governanceSchemas.js";
import type {
  GovernanceMode,
  GovernanceResponse,
  GovernanceResult,
  GovernanceTask,
  NormalizedIssue,
  RawIssue,
  RiskLevel,
  SplitTask
} from "../schemas/governanceSchemas.js";
import type {
  ContextSource,
  IssueContextInput,
  RelevantRepositoryContext
} from "../repository/repositoryContext.js";

const DEFAULT_TASKS: GovernanceTask[] = [
  "dedupe",
  "clarify",
  "split_tasks",
  "generate_tests",
  "risk_report"
];

const BUG_WORDS = ["bug", "error", "fail", "failed", "blank", "crash", "exception", "报错", "失败", "异常"];
const FEATURE_WORDS = ["feature", "support", "add", "新增", "支持", "需求", "增加"];
const TASK_WORDS = ["task", "optimize", "improve", "compress", "优化", "改进", "调整", "压缩"];
const DOC_WORDS = ["docs", "readme", "文档", "说明"];
const QUESTION_WORDS = ["how", "why", "what", "如何", "为什么", "吗", "?"];

export interface IssueGovernanceServiceOptions {
  repositoryPath?: string;
  tasks?: GovernanceTask[];
  mode?: GovernanceMode;
  candidateIssues?: RawIssue[];
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
 * Prepares and runs issue governance analysis.
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

  /**
   * Returns a deterministic governance result that can later be replaced by LLM analysis.
   */
  async governIssue(
    issue: RawIssue,
    options: IssueGovernanceServiceOptions = {}
  ): Promise<GovernanceResponse> {
    const prepared = await this.prepareInput(issue, options);
    const tasks = options.tasks ?? DEFAULT_TASKS;
    const result = buildGovernanceResult(
      prepared.issue,
      options.candidateIssues ?? [],
      tasks,
      prepared.repositoryContext
    );
    const response = {
      repository: issue.repo,
      mode: options.mode ?? "analyze_only",
      summary: {
        analyzedIssues: 1,
        duplicateGroups: result.dedupe.isDuplicate ? 1 : 0,
        unclearIssues: result.clarification.needed ? 1 : 0,
        highRiskIssues: ["high", "critical"].includes(result.riskReport.level) ? 1 : 0,
        suggestedTasks: result.splitTasks.length,
        testPoints: result.testPoints.length
      },
      issues: [result]
    };

    return governanceResponseSchema.parse(response);
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

function buildGovernanceResult(
  issue: RawIssue,
  candidates: RawIssue[],
  tasks: GovernanceTask[],
  repositoryContext: RelevantRepositoryContext | null
): GovernanceResult {
  const normalized = normalizeIssue(issue, repositoryContext);
  const dedupe = tasks.includes("dedupe") ? detectDuplicate(issue, candidates) : emptyDedupe();
  const clarification = tasks.includes("clarify") ? buildClarification(normalized) : emptyClarification();
  const splitTasks = tasks.includes("split_tasks") ? buildSplitTasks(normalized, clarification.needed) : [];
  const riskReport = tasks.includes("risk_report")
    ? buildRiskReport(normalized, repositoryContext)
    : { level: "low" as RiskLevel, reasons: [], impactScope: [], suggestion: "" };
  const testPoints = tasks.includes("generate_tests") ? buildTestPoints(normalized, riskReport.level) : [];
  const proposedActions = buildProposedActions(issue.number, clarification.commentDraft);

  return governanceResultSchema.parse({
    issueNumber: issue.number,
    title: issue.title,
    classification: {
      type: normalized.issueType,
      module: normalized.module,
      clarityScore: normalized.clarityScore,
      riskLevel: riskReport.level
    },
    dedupe,
    clarification,
    splitTasks,
    testPoints,
    riskReport,
    proposedActions
  });
}

function normalizeIssue(
  issue: RawIssue,
  repositoryContext: RelevantRepositoryContext | null
): NormalizedIssue {
  const text = `${issue.title}\n${issue.body}\n${issue.labels.join(" ")}`;
  const lowered = text.toLowerCase();
  const issueType = includesAny(lowered, BUG_WORDS)
    ? "bug"
    : includesAny(lowered, FEATURE_WORDS)
      ? "feature"
      : includesAny(lowered, DOC_WORDS)
        ? "docs"
        : includesAny(lowered, QUESTION_WORDS)
          ? "question"
          : includesAny(lowered, TASK_WORDS)
            ? "task"
            : inferContextIssueType(lowered, repositoryContext);
  const missingFields = getMissingFields(issueType, lowered, hasRepositoryEvidence(repositoryContext));

  return {
    repo: issue.repo,
    number: issue.number,
    title: issue.title,
    summary: issue.body ? firstLine(issue.body) : issue.title,
    issueType,
    module: inferModule(issue, repositoryContext),
    evidence: [issue.title, ...issue.labels].filter(Boolean),
    missingFields,
    clarityScore: Math.max(0.1, Math.min(1, 1 - missingFields.length * 0.2))
  };
}

function getMissingFields(
  issueType: NormalizedIssue["issueType"],
  loweredText: string,
  hasRepositoryContext: boolean
): string[] {
  if (issueType === "bug") {
    return [
      !includesAny(loweredText, ["step", "reproduce", "复现", "步骤"]) ? "复现步骤" : "",
      !includesAny(loweredText, ["expected", "预期"]) ? "预期结果" : "",
      !includesAny(loweredText, ["actual", "实际"]) ? "实际结果" : ""
    ].filter(Boolean);
  }

  if (issueType === "feature") {
    return [
      !includesAny(loweredText, ["acceptance", "验收", "标准"]) ? "验收标准" : "",
      !includesAny(loweredText, ["scenario", "场景"]) ? "使用场景" : ""
    ].filter(Boolean);
  }

  if (issueType === "task" && hasRepositoryContext) {
    return [];
  }

  return loweredText.length < 80 ? ["更多上下文"] : [];
}

function detectDuplicate(issue: RawIssue, candidates: RawIssue[]): GovernanceResult["dedupe"] {
  const currentTokens = tokenize(`${issue.title} ${issue.body}`);
  const scored = candidates
    .filter((candidate) => candidate.number !== issue.number)
    .map((candidate) => ({
      issueNumber: candidate.number,
      confidence: jaccard(currentTokens, tokenize(`${candidate.title} ${candidate.body}`)),
      reason: `标题或正文与 #${candidate.number} 存在相似关键词`
    }))
    .filter((candidate) => candidate.confidence >= 0.35)
    .sort((left, right) => right.confidence - left.confidence)
    .slice(0, 3);

  return {
    isDuplicate: scored.length > 0 && scored[0].confidence >= 0.55,
    canonicalIssue: scored.length > 0 && scored[0].confidence >= 0.55 ? scored[0].issueNumber : null,
    duplicateCandidates: scored,
    confidence: scored[0]?.confidence ?? 0,
    reason: scored.length > 0 ? "发现相似 Issue 候选，需人工复核后再处理。" : "未发现足够相似的候选 Issue。"
  };
}

function buildClarification(normalized: NormalizedIssue): GovernanceResult["clarification"] {
  const questions = normalized.missingFields.map((field) => `请补充${field}，方便维护者判断影响范围。`);
  const commentDraft = questions.length > 0 ? `为了继续治理该 Issue，请补充：\n${questions.join("\n")}` : "";

  return {
    needed: questions.length > 0,
    missingFields: normalized.missingFields,
    questions,
    commentDraft
  };
}

function buildSplitTasks(normalized: NormalizedIssue, needsClarification: boolean): SplitTask[] {
  if (needsClarification) {
    return [
      {
        title: "补充 Issue 关键信息",
        type: "unknown",
        description: "当前信息不足，先补充上下文再拆开发任务。",
        dependencies: [],
        acceptanceCriteria: ["Issue 描述包含复现、预期、实际或验收标准等关键信息"]
      }
    ];
  }

  const analysisTaskTitle = isResumeCompressionIssue(normalized)
    ? "分析 resume 简历压缩路径"
    : `分析 ${normalized.module} 模块影响范围`;

  return [
    {
      title: analysisTaskTitle,
      type: inferTaskType(normalized.module),
      description: normalized.summary,
      dependencies: [],
      acceptanceCriteria: isResumeCompressionIssue(normalized)
        ? ["定位生成简历和分页/缩放相关代码", "明确无法压缩到一页时的用户确认流程"]
        : ["确认影响文件、接口或用户路径", "明确回归验证范围"]
    },
    {
      title: "补充治理结果回归测试",
      type: "test",
      description: "覆盖正常路径、异常输入和回归风险。",
      dependencies: [analysisTaskTitle],
      acceptanceCriteria: ["关键风险有对应测试点", "测试失败时能定位原因"]
    }
  ];
}

function buildTestPoints(normalized: NormalizedIssue, riskLevel: RiskLevel): string[] {
  const points = isResumeCompressionIssue(normalized)
    ? [
        "验证简历内容可自动压缩到一页。",
        "验证内容过多无法压缩时会提示用户确认重点内容。",
        "验证压缩后模板样式和导出结果不被破坏。"
      ]
    : [
        `验证 ${normalized.module} 模块正常路径。`,
        "验证无效输入或信息缺失时返回清晰错误。",
        "验证本次修改不会破坏既有 Schema 和评论渲染。"
      ];

  if (normalized.issueType === "bug") {
    points.unshift("按 Issue 描述复现问题，并验证修复后的回归路径。");
  }

  if (["high", "critical"].includes(riskLevel)) {
    points.push("补充权限、幂等和失败重试场景验证。");
  }

  return points;
}

function buildRiskReport(
  normalized: NormalizedIssue,
  repositoryContext: RelevantRepositoryContext | null
): GovernanceResult["riskReport"] {
  const reasons: string[] = [];

  if (normalized.clarityScore < 0.5) {
    reasons.push("Issue 信息不足，存在误判影响范围的风险。");
  }

  if (["webhook", "github", "auth", "permission", "token", "api"].some((word) => normalized.module.includes(word))) {
    reasons.push("可能影响外部入口、鉴权或 GitHub 写操作链路。");
  }

  if (hasUsableCodeContext(repositoryContext?.codeContext)) {
    reasons.push("已结合 CodeGraph 命中的相关源码上下文，后续判断应引用具体文件证据。");
  } else if (repositoryContext?.fileList.length) {
    reasons.push(`已加载仓库文件列表，当前影响范围推断为 ${normalized.module} 模块。`);
  }

  const level: RiskLevel = reasons.some((reason) => reason.includes("鉴权") || reason.includes("写操作"))
    ? "high"
    : normalized.clarityScore < 0.5
      ? "medium"
      : "low";

  return {
    level,
    reasons: reasons.length > 0 ? reasons : ["当前描述未暴露明显高风险链路。"],
    impactScope: [normalized.module],
    suggestion: normalized.clarityScore < 0.5 ? "先补充关键信息，再执行开发或自动化治理。" : "保持人工确认后再执行写操作。",
    contextSummary: repositoryContext
      ? {
          provider: repositoryContext.provider,
          status: repositoryContext.contextSources.some((source) => source.status === "used")
            ? "used"
            : repositoryContext.contextSources.some((source) => source.status === "failed")
              ? "failed"
              : "missing",
          repositoryPath: repositoryContext.repoPath,
          query: repositoryContext.query,
          matchedFiles: repositoryContext.matchedFiles,
          warnings: repositoryContext.warnings
        }
      : {
          provider: "none",
          status: "missing",
          query: "",
          matchedFiles: [],
          warnings: ["Repository context was not configured for this request."]
        }
  };
}

function buildProposedActions(issueNumber: number, clarificationDraft: string): GovernanceResult["proposedActions"] {
  return clarificationDraft
    ? [
        {
          actionId: `comment-${issueNumber}-clarify`,
          type: "comment",
          requiresApproval: true,
          content: clarificationDraft,
          labels: [],
          impactScope: ["github_issue_comment"]
        }
      ]
    : [];
}

function emptyDedupe(): GovernanceResult["dedupe"] {
  return {
    isDuplicate: false,
    canonicalIssue: null,
    duplicateCandidates: [],
    confidence: 0,
    reason: ""
  };
}

function emptyClarification(): GovernanceResult["clarification"] {
  return {
    needed: false,
    missingFields: [],
    questions: [],
    commentDraft: ""
  };
}

function inferModule(issue: RawIssue, repositoryContext: RelevantRepositoryContext | null): string {
  const labels = issue.labels.map((label) => label.toLowerCase());
  const moduleLabel = labels.find((label) => label.startsWith("module:") || label.startsWith("area:"));

  if (moduleLabel) {
    return moduleLabel.split(":")[1] || "unknown";
  }

  const text = `${issue.title} ${issue.body}`.toLowerCase();
  const knownModules = ["webhook", "github", "uumit", "mcp", "schema", "api", "service", "repository", "auth"];
  const explicitModule = knownModules.find((moduleName) => text.includes(moduleName));
  if (explicitModule) {
    return explicitModule;
  }

  return inferModuleFromRepositoryContext(text, repositoryContext);
}

function inferContextIssueType(
  loweredText: string,
  repositoryContext: RelevantRepositoryContext | null
): NormalizedIssue["issueType"] {
  const contextText = getRepositoryContextText(repositoryContext);
  if (includesAny(`${loweredText} ${contextText}`, ["resume", "cv", "简历"])) {
    return "task";
  }

  return "unknown";
}

function inferModuleFromRepositoryContext(
  loweredText: string,
  repositoryContext: RelevantRepositoryContext | null
): string {
  const contextText = getRepositoryContextText(repositoryContext);

  if (includesAny(`${loweredText} ${contextText}`, ["resume", "cv", "简历"])) {
    return "resume";
  }

  if (includesAny(`${loweredText} ${contextText}`, ["editor", "toolbar", "canvas", "编辑器"])) {
    return "editor";
  }

  const matchedFile = repositoryContext?.fileList.find((filePath) =>
    tokenize(loweredText).has(firstPathSegment(filePath).toLowerCase())
  );

  return matchedFile ? firstPathSegment(matchedFile) : "unknown";
}

function inferTaskType(moduleName: string): SplitTask["type"] {
  return ["resume", "editor", "ui", "docs"].some((name) => moduleName.includes(name))
    ? "frontend"
    : "backend";
}

function isResumeCompressionIssue(normalized: NormalizedIssue): boolean {
  const text = `${normalized.title} ${normalized.summary}`.toLowerCase();
  return normalized.module === "resume" && includesAny(text, ["compress", "压缩"]);
}

function getRepositoryContextText(repositoryContext: RelevantRepositoryContext | null): string {
  if (!repositoryContext) {
    return "";
  }

  return [
    repositoryContext.repoPath,
    repositoryContext.projectProfile,
    repositoryContext.codeContext,
    ...repositoryContext.fileList
  ]
    .join(" ")
    .toLowerCase();
}

function hasUsableCodeContext(codeContext?: string): boolean {
  return Boolean(codeContext?.trim()) && !codeContext!.startsWith("No relevant code found");
}

function hasRepositoryEvidence(repositoryContext: RelevantRepositoryContext | null): boolean {
  return Boolean(
    repositoryContext &&
      (hasUsableCodeContext(repositoryContext.codeContext) || repositoryContext.fileList.length > 0)
  );
}

function firstPathSegment(filePath: string): string {
  return filePath.split(/[\\/]/)[0] ?? "";
}

function includesAny(value: string, words: string[]): boolean {
  return words.some((word) => value.includes(word));
}

function firstLine(value: string): string {
  return value.split(/\r?\n/).find((line) => line.trim().length > 0)?.trim() ?? "";
}

function tokenize(value: string): Set<string> {
  const tokens = value.toLowerCase().match(/[\p{L}\p{N}_-]{3,}/gu) ?? [];
  return new Set(tokens);
}

function jaccard(left: Set<string>, right: Set<string>): number {
  if (left.size === 0 || right.size === 0) {
    return 0;
  }

  const intersection = [...left].filter((token) => right.has(token)).length;
  const union = new Set([...left, ...right]).size;
  return Number((intersection / union).toFixed(2));
}

function formatContextSource(source: ContextSource): string {
  const details = [source.provider, source.path, source.query, source.message].filter(Boolean).join(" | ");
  return `- ${source.type}: ${source.status}${details ? ` | ${details}` : ""}`;
}
