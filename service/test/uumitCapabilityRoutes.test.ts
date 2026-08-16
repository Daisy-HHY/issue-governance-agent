import { describe, expect, it } from "vitest";
import { createUumitCapabilityRoutes } from "../src/api/uumitCapabilityRoutes.js";
import { IssueGovernanceService } from "../src/services/issueGovernanceService.js";
import type { AppEnv } from "../src/config/env.js";

const env: AppEnv = {
  PORT: 3000,
  GITHUB_APP_ID: "1",
  GITHUB_APP_PRIVATE_KEY: "key",
  GITHUB_WEBHOOK_SECRET: "secret",
  GITHUB_TRIGGER_USERS: "",
  GITHUB_TRIGGER_ASSOCIATIONS: "OWNER,MEMBER,COLLABORATOR",
  UUMIT_API_KEY: "uumit",
  OPENAI_API_KEY: "openai",
  OPENAI_MODEL: "gpt-4.1-mini",
  OPENAI_EMBEDDING_MODEL: "text-embedding-3-small",
  LOG_LEVEL: "info"
};

describe("uumit capability routes", () => {
  it("rejects requests without API key", async () => {
    const app = createUumitCapabilityRoutes({
      env,
      governanceService: new IssueGovernanceService()
    });

    const response = await app.request("/github/issues/govern", {
      method: "POST",
      body: JSON.stringify({ repo: "owner/project", issueNumber: 1 })
    });

    expect(response.status).toBe(401);
  });

  it("returns a governance response and reuses the same requestId", async () => {
    const app = createUumitCapabilityRoutes({
      env,
      governanceService: new IssueGovernanceService()
    });
    const request = {
      source: "uumit",
      requestId: "req-1",
      repo: "owner/project",
      issueNumber: 1,
      tasks: ["risk_report"]
    };

    const first = await app.request("/github/issues/govern", {
      method: "POST",
      headers: {
        "x-api-key": env.UUMIT_API_KEY,
        "content-type": "application/json"
      },
      body: JSON.stringify(request)
    });
    const second = await app.request("/github/issues/govern", {
      method: "POST",
      headers: {
        "x-api-key": env.UUMIT_API_KEY,
        "content-type": "application/json"
      },
      body: JSON.stringify(request)
    });

    expect(first.status).toBe(200);
    expect(await first.json()).toMatchObject({
      requestId: "req-1",
      status: "succeeded",
      capability: "github_issue_governance"
    });
    expect(await second.json()).toMatchObject({ requestId: "req-1" });
  });
});
