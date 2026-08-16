import type { GovernanceResponse, GovernanceResult } from "../schemas/governanceSchemas.js";

const MAX_MARKDOWN_LENGTH = 12_000;

/**
 * Renders governance output as a concise GitHub issue comment.
 */
export function renderGovernanceComment(response: GovernanceResponse): string {
  const sections = [
    "## Issue 智能治理结果",
    "",
    renderSummary(response),
    "",
    ...response.issues.flatMap(renderIssue),
    "",
    "> 安全声明：本次只生成治理建议，不会自动关闭 Issue、分配负责人或创建子 Issue。"
  ];
  const markdown = sections.join("\n");

  return markdown.length > MAX_MARKDOWN_LENGTH
    ? `${markdown.slice(0, MAX_MARKDOWN_LENGTH)}\n\n[评论内容已截断]`
    : markdown;
}

export function renderErrorComment(message: string): string {
  return [`## Issue 智能治理未执行`, "", message, "", "> 未执行任何写操作。"].join("\n");
}

function renderSummary(response: GovernanceResponse): string {
  return [
    `- 仓库：${response.repository}`,
    `- 分析 Issue：${response.summary.analyzedIssues}`,
    `- 需澄清：${response.summary.unclearIssues}`,
    `- 高风险：${response.summary.highRiskIssues}`,
    `- 建议任务：${response.summary.suggestedTasks}`,
    `- 测试点：${response.summary.testPoints}`
  ].join("\n");
}

function renderIssue(issue: GovernanceResult): string[] {
  return [
    `### #${issue.issueNumber} ${issue.title}`,
    "",
    `- 类型：${issue.classification.type}`,
    `- 模块：${issue.classification.module}`,
    `- 清晰度：${issue.classification.clarityScore}`,
    `- 风险等级：${issue.riskReport.level}`,
    "",
    "#### 去重判断",
    issue.dedupe.isDuplicate
      ? `疑似重复：#${issue.dedupe.canonicalIssue}，置信度 ${issue.dedupe.confidence}。${issue.dedupe.reason}`
      : issue.dedupe.reason || "未发现明确重复 Issue。",
    "",
    "#### 澄清问题",
    issue.clarification.needed
      ? issue.clarification.questions.map((question) => `- ${question}`).join("\n")
      : "暂无必须澄清的问题。",
    "",
    "#### 任务拆分",
    issue.splitTasks.length > 0
      ? issue.splitTasks
          .map((task) => `- ${task.title}（${task.type}）：${task.acceptanceCriteria.join("；")}`)
          .join("\n")
      : "本次未生成拆分任务。",
    "",
    "#### 测试点",
    issue.testPoints.length > 0
      ? issue.testPoints.map((point) => `- ${point}`).join("\n")
      : "本次未生成测试点。",
    "",
    "#### 风险报告",
    issue.riskReport.reasons.map((reason) => `- ${reason}`).join("\n"),
    issue.riskReport.suggestion ? `建议：${issue.riskReport.suggestion}` : ""
  ];
}
