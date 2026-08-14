import { z } from "zod";

export const issueStateSchema = z.enum(["open", "closed"]);
export const issueTypeSchema = z.enum(["bug", "feature", "question", "docs", "task", "unknown"]);
export const riskLevelSchema = z.enum(["low", "medium", "high", "critical"]);
export const governanceTaskSchema = z.enum([
  "dedupe",
  "clarify",
  "split_tasks",
  "generate_tests",
  "risk_report"
]);
export const governanceModeSchema = z.enum([
  "analyze_only",
  "comment_result",
  "draft_action",
  "apply_with_approval",
  "auto_apply"
]);
export const proposedActionTypeSchema = z.enum([
  "comment",
  "label",
  "close_issue",
  "assign_owner",
  "create_child_issue"
]);

export const issueCommentSchema = z.object({
  id: z.number().int().positive(),
  author: z.string().min(1),
  body: z.string().default(""),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime().optional()
});

export const rawIssueSchema = z.object({
  repo: z.string().min(1),
  number: z.number().int().positive(),
  title: z.string().min(1),
  body: z.string().default(""),
  labels: z.array(z.string()).default([]),
  state: issueStateSchema,
  author: z.string().min(1),
  assignees: z.array(z.string()).default([]),
  milestone: z.string().optional(),
  comments: z.array(issueCommentSchema).default([]),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime()
});

export const normalizedIssueSchema = z.object({
  repo: z.string().min(1),
  number: z.number().int().positive(),
  title: z.string().min(1),
  summary: z.string().default(""),
  issueType: issueTypeSchema,
  module: z.string().default("unknown"),
  evidence: z.array(z.string()).default([]),
  missingFields: z.array(z.string()).default([]),
  clarityScore: z.number().min(0).max(1)
});

export const issueClassificationSchema = z.object({
  type: issueTypeSchema,
  module: z.string().default("unknown"),
  clarityScore: z.number().min(0).max(1),
  riskLevel: riskLevelSchema
});

export const dedupeResultSchema = z.object({
  isDuplicate: z.boolean(),
  canonicalIssue: z.number().int().positive().nullable().default(null),
  duplicateCandidates: z
    .array(
      z.object({
        issueNumber: z.number().int().positive(),
        confidence: z.number().min(0).max(1),
        reason: z.string().min(1)
      })
    )
    .default([]),
  confidence: z.number().min(0).max(1),
  reason: z.string().default("")
});

export const clarificationResultSchema = z.object({
  needed: z.boolean(),
  missingFields: z.array(z.string()).default([]),
  questions: z.array(z.string()).default([]),
  commentDraft: z.string().default("")
});

export const splitTaskSchema = z.object({
  title: z.string().min(1),
  type: z.enum(["frontend", "backend", "test", "docs", "design", "devops", "unknown"]),
  description: z.string().default(""),
  dependencies: z.array(z.string()).default([]),
  acceptanceCriteria: z.array(z.string()).default([])
});

export const riskReportSchema = z.object({
  level: riskLevelSchema,
  reasons: z.array(z.string()).default([]),
  impactScope: z.array(z.string()).default([]),
  suggestion: z.string().default("")
});

export const proposedActionSchema = z.object({
  actionId: z.string().min(1),
  type: proposedActionTypeSchema,
  requiresApproval: z.boolean().default(true),
  content: z.string().optional(),
  labels: z.array(z.string()).default([]),
  targetIssueNumber: z.number().int().positive().optional(),
  impactScope: z.array(z.string()).default([])
});

export const governanceResultSchema = z.object({
  issueNumber: z.number().int().positive(),
  title: z.string().min(1),
  classification: issueClassificationSchema,
  dedupe: dedupeResultSchema,
  clarification: clarificationResultSchema,
  splitTasks: z.array(splitTaskSchema).default([]),
  testPoints: z.array(z.string()).default([]),
  riskReport: riskReportSchema,
  proposedActions: z.array(proposedActionSchema).default([])
});

export const governanceSummarySchema = z.object({
  analyzedIssues: z.number().int().nonnegative(),
  duplicateGroups: z.number().int().nonnegative(),
  unclearIssues: z.number().int().nonnegative(),
  highRiskIssues: z.number().int().nonnegative(),
  suggestedTasks: z.number().int().nonnegative(),
  testPoints: z.number().int().nonnegative()
});

export const issueRangeSchema = z.object({
  state: issueStateSchema.default("open"),
  limit: z.number().int().positive().max(100).default(50),
  labels: z.array(z.string()).default([]),
  since: z.string().datetime().nullable().default(null)
});

export const governanceRequestSchema = z
  .object({
    source: z.enum(["github", "uumit", "mcp", "api"]).default("api"),
    requestId: z.string().min(1).optional(),
    repo: z.string().min(1),
    githubTokenRef: z.string().min(1).optional(),
    issueNumber: z.number().int().positive().optional(),
    issueRange: issueRangeSchema.optional(),
    tasks: z.array(governanceTaskSchema).default([
      "dedupe",
      "clarify",
      "split_tasks",
      "generate_tests",
      "risk_report"
    ]),
    mode: governanceModeSchema.default("analyze_only"),
    outputLanguage: z.string().min(2).default("zh-CN")
  })
  .refine((value) => value.issueNumber !== undefined || value.issueRange !== undefined, {
    message: "Either issueNumber or issueRange is required",
    path: ["issueNumber"]
  });

export const governanceResponseSchema = z.object({
  repository: z.string().min(1),
  mode: governanceModeSchema,
  summary: governanceSummarySchema,
  issues: z.array(governanceResultSchema)
});

export const uumitUsageSchema = z.object({
  issueCount: z.number().int().nonnegative(),
  inputTokens: z.number().int().nonnegative().default(0),
  outputTokens: z.number().int().nonnegative().default(0),
  durationMs: z.number().int().nonnegative(),
  billingUnit: z.enum(["per_issue", "per_batch"]).default("per_issue")
});

export const uumitGovernanceResponseSchema = z.object({
  requestId: z.string().min(1),
  status: z.enum(["succeeded", "failed", "running"]),
  capability: z.literal("github_issue_governance"),
  repository: z.string().min(1),
  resultMarkdown: z.string().default(""),
  resultJson: governanceResponseSchema.optional(),
  usage: uumitUsageSchema.optional(),
  errorCode: z.string().optional(),
  message: z.string().optional()
});

export type IssueState = z.infer<typeof issueStateSchema>;
export type IssueType = z.infer<typeof issueTypeSchema>;
export type RiskLevel = z.infer<typeof riskLevelSchema>;
export type GovernanceTask = z.infer<typeof governanceTaskSchema>;
export type GovernanceMode = z.infer<typeof governanceModeSchema>;
export type IssueComment = z.infer<typeof issueCommentSchema>;
export type RawIssue = z.infer<typeof rawIssueSchema>;
export type NormalizedIssue = z.infer<typeof normalizedIssueSchema>;
export type IssueClassification = z.infer<typeof issueClassificationSchema>;
export type DedupeResult = z.infer<typeof dedupeResultSchema>;
export type ClarificationResult = z.infer<typeof clarificationResultSchema>;
export type SplitTask = z.infer<typeof splitTaskSchema>;
export type RiskReport = z.infer<typeof riskReportSchema>;
export type ProposedAction = z.infer<typeof proposedActionSchema>;
export type GovernanceResult = z.infer<typeof governanceResultSchema>;
export type GovernanceSummary = z.infer<typeof governanceSummarySchema>;
export type GovernanceRequest = z.infer<typeof governanceRequestSchema>;
export type GovernanceResponse = z.infer<typeof governanceResponseSchema>;
export type UumitGovernanceResponse = z.infer<typeof uumitGovernanceResponseSchema>;
