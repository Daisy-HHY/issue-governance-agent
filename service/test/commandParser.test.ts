import { describe, expect, it } from "vitest";
import { parseGovernanceCommand } from "../src/github/commandParser.js";

describe("command parser", () => {
  it("parses full governance command with task arguments", () => {
    const command = parseGovernanceCommand("/issue-govern tasks=dedupe,clarify,risk");

    expect(command?.tasks).toEqual(["dedupe", "clarify", "risk_report"]);
  });

  it("parses single-purpose commands", () => {
    expect(parseGovernanceCommand("/issue-risk")?.tasks).toEqual(["risk_report"]);
    expect(parseGovernanceCommand("/issue-tests")?.tasks).toEqual(["generate_tests"]);
  });

  it("ignores non-governance comments and reports unknown commands", () => {
    expect(parseGovernanceCommand("hello")).toBeNull();
    expect(parseGovernanceCommand("/issue-unknown")?.error).toContain("未知治理指令");
  });
});
