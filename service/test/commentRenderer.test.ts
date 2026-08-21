import { describe, expect, it } from "vitest";
import { renderErrorComment, renderGovernanceComment } from "../src/github/commentRenderer.js";
import type { GovernanceResponse } from "../src/schemas/governanceSchemas.js";

describe("comment renderer", () => {
  it("renders a readable GitHub markdown comment", () => {
    const response: GovernanceResponse = {
      repository: "owner/project",
      mode: "analyze_only",
      summary: {
        analyzedIssues: 1,
        duplicateGroups: 0,
        unclearIssues: 1,
        highRiskIssues: 0,
        suggestedTasks: 1,
        testPoints: 1
      },
      issues: [
        {
          issueNumber: 1,
          title: "Webhook fails",
          classification: {
            type: "bug",
            module: "webhook",
            clarityScore: 0.4,
            riskLevel: "medium"
          },
          dedupe: {
            isDuplicate: false,
            canonicalIssue: null,
            duplicateCandidates: [],
            confidence: 0,
            reason: "未发现重复"
          },
          clarification: {
            needed: true,
            missingFields: ["复现步骤"],
            questions: ["请补充复现步骤"],
            commentDraft: "请补充复现步骤"
          },
          splitTasks: [
            {
              title: "补充 Issue 关键信息",
              type: "unknown",
              description: "",
              dependencies: [],
              acceptanceCriteria: ["信息完整"]
            }
          ],
          testPoints: ["验证回归路径"],
          riskReport: {
            level: "medium",
            reasons: ["信息不足"],
            impactScope: ["webhook"],
            suggestion: "先澄清",
            contextSummary: {
              provider: "cli",
              status: "used",
              repositoryPath: "D:/project/owner-project",
              query: "webhook",
              matchedFiles: ["service/src/github/webhookHandler.ts"],
              warnings: ["CodeGraph uses tree-sitter approximation; use text search for exhaustive impact checks."]
            }
          },
          proposedActions: []
        }
      ]
    };

    const markdown = renderGovernanceComment(response);

    expect(markdown).toContain("Issue 智能治理结果");
    expect(markdown).toContain("仓库上下文");
    expect(markdown).toContain("service/src/github/webhookHandler.ts");
    expect(markdown).toContain("安全声明");
    expect(markdown).toContain("不会自动关闭");
  });

  it("renders error comments without write-action claims", () => {
    expect(renderErrorComment("无权限")).toContain("未执行任何写操作");
  });
});
