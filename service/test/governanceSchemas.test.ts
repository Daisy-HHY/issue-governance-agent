import { describe, expect, it } from "vitest";
import {
  governanceRequestSchema,
  governanceResultSchema,
  rawIssueSchema,
  riskLevelSchema,
  uumitGovernanceResponseSchema
} from "../src/schemas/governanceSchemas.js";

describe("governance schemas", () => {
  it("parses a raw GitHub issue", () => {
    const issue = rawIssueSchema.parse({
      repo: "owner/project",
      number: 1842,
      title: "Exported PDF is blank",
      state: "open",
      author: "daisy",
      createdAt: "2026-08-13T08:00:00.000Z",
      updatedAt: "2026-08-13T08:10:00.000Z"
    });

    expect(issue.labels).toEqual([]);
    expect(issue.comments).toEqual([]);
    expect(issue.body).toBe("");
  });

  it("rejects unsupported risk levels", () => {
    expect(riskLevelSchema.safeParse("urgent").success).toBe(false);
    expect(riskLevelSchema.safeParse("critical").success).toBe(true);
  });

  it("defaults proposed actions to approval required", () => {
    const result = governanceResultSchema.parse({
      issueNumber: 1842,
      title: "Exported PDF is blank",
      classification: {
        type: "bug",
        module: "export",
        clarityScore: 0.68,
        riskLevel: "high"
      },
      dedupe: {
        isDuplicate: true,
        canonicalIssue: 1761,
        confidence: 0.92,
        reason: "Similar export failure"
      },
      clarification: {
        needed: true,
        missingFields: ["steps"],
        questions: ["Please provide reproduction steps"]
      },
      riskReport: {
        level: "high",
        reasons: ["Core export path is affected"]
      },
      proposedActions: [
        {
          actionId: "comment-1",
          type: "comment",
          content: "Please provide reproduction steps"
        }
      ]
    });

    expect(result.proposedActions[0]?.requiresApproval).toBe(true);
  });

  it("requires issueNumber or issueRange for governance requests", () => {
    const invalid = governanceRequestSchema.safeParse({
      repo: "owner/project"
    });
    const valid = governanceRequestSchema.parse({
      repo: "owner/project",
      issueNumber: 1842
    });

    expect(invalid.success).toBe(false);
    expect(valid.tasks).toContain("dedupe");
    expect(valid.mode).toBe("analyze_only");
  });

  it("parses a UUMIT capability response", () => {
    const response = uumitGovernanceResponseSchema.parse({
      requestId: "uumit-order-1",
      status: "succeeded",
      capability: "github_issue_governance",
      repository: "owner/project",
      resultMarkdown: "## Issue 智能治理结果",
      usage: {
        issueCount: 1,
        durationMs: 1200
      }
    });

    expect(response.usage?.billingUnit).toBe("per_issue");
    expect(JSON.stringify(response)).toContain("github_issue_governance");
  });
});
