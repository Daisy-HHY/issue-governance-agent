import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { loadEnv } from "../src/config/env.js";

describe("env config", () => {
  it("loads local .env values and lets process env override them", () => {
    const envFilePath = join(mkdtempSync(join(tmpdir(), "issue-governance-env-")), ".env");
    writeFileSync(
      envFilePath,
      [
        "GITHUB_APP_ID=from-file",
        "GITHUB_APP_PRIVATE_KEY=private-key",
        "GITHUB_WEBHOOK_SECRET=webhook-secret",
        // "UUMIT_API_KEY=uumit",
        "OPENAI_API_KEY=openai",
        "REPOSITORY_CONTEXT_ROOT=D:/project/repository-context",
        "REPOSITORY_CONTEXT_AUTO_CLONE=true",
        "LOG_LEVEL=debug"
      ].join("\n")
    );

    const env = loadEnv(
      {
        GITHUB_APP_ID: "from-process"
      },
      envFilePath
    );

    expect(env.GITHUB_APP_ID).toBe("from-process");
    expect(env.GITHUB_APP_PRIVATE_KEY).toBe("private-key");
    expect(env.REPOSITORY_CONTEXT_ROOT).toBe("D:/project/repository-context");
    expect(env.REPOSITORY_CONTEXT_AUTO_CLONE).toBe(true);
    expect(env.LOG_LEVEL).toBe("debug");
  });
});
