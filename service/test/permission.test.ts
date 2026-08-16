import { describe, expect, it } from "vitest";
import { canTriggerGovernance } from "../src/github/permission.js";

describe("permission", () => {
  it("allows maintainers and configured users", () => {
    expect(canTriggerGovernance({ author: "daisy", authorAssociation: "OWNER" })).toBe(true);
    expect(canTriggerGovernance({ author: "daisy", allowedUsers: ["Daisy"] })).toBe(true);
  });

  it("rejects outside contributors by default", () => {
    expect(canTriggerGovernance({ author: "guest", authorAssociation: "CONTRIBUTOR" })).toBe(false);
  });
});
