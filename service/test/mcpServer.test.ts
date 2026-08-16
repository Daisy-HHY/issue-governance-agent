import { describe, expect, it } from "vitest";
import { handleIssueGovernanceTool, issueGovernanceTools } from "../src/mcp/mcpServer.js";

describe("mcp server helpers", () => {
  it("lists all planned issue governance tools", () => {
    expect(issueGovernanceTools.map((tool) => tool.name)).toEqual([
      "github_issue_list",
      "github_issue_govern",
      "issue_dedupe",
      "issue_clarify",
      "issue_split_tasks",
      "issue_generate_tests",
      "issue_risk_report",
      "issue_governance_digest"
    ]);
  });

  it("handles a single-purpose risk report tool", async () => {
    const result = await handleIssueGovernanceTool("issue_risk_report", {
      repo: "owner/project",
      issueNumber: 1
    });

    expect(JSON.stringify(result)).toContain("riskReport");
  });
});
