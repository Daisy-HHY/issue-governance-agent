import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { z } from "zod";

const envSchema = z.object({
  PORT: z.coerce.number().int().positive().default(3000),
  GITHUB_APP_ID: z.string().min(1),
  GITHUB_APP_PRIVATE_KEY: z.string().min(1),
  GITHUB_WEBHOOK_SECRET: z.string().min(1),
  GITHUB_TRIGGER_USERS: z.string().default(""),
  GITHUB_TRIGGER_ASSOCIATIONS: z.string().default("OWNER,MEMBER,COLLABORATOR"),
  UUMIT_API_KEY: z.string().default(""),
  OPENAI_API_KEY: z.string().min(1),
  OPENAI_MODEL: z.string().min(1).default("gpt-4.1-mini"),
  OPENAI_EMBEDDING_MODEL: z.string().min(1).default("text-embedding-3-small"),
  REPOSITORY_CONTEXT_MAP: z.string().default(""),
  REPOSITORY_CONTEXT_PATH: z.string().default(""),
  REPOSITORY_CONTEXT_ROOT: z.string().default(""),
  REPOSITORY_CONTEXT_AUTO_CLONE: z.preprocess((value) => {
    if (typeof value !== "string") {
      return value;
    }

    const normalized = value.trim().toLowerCase();
    if (["true", "1", "yes", "on"].includes(normalized)) {
      return true;
    }
    if (["false", "0", "no", "off", ""].includes(normalized)) {
      return false;
    }

    return value;
  }, z.boolean()).default(false),
  LOG_LEVEL: z.enum(["debug", "info", "warn", "error"]).default("info")
});

export type AppEnv = z.infer<typeof envSchema>;

export function loadEnv(
  source: NodeJS.ProcessEnv = process.env,
  envFilePath = resolve(process.cwd(), ".env")
): AppEnv {
  const result = envSchema.safeParse({
    ...loadDotEnv(envFilePath),
    ...source
  });

  if (!result.success) {
    const missing = result.error.issues.map((issue) => issue.path.join(".")).join(", ");
    throw new Error(`Invalid environment configuration: ${missing}`);
  }

  return result.data;
}

/**
 * Loads simple KEY=VALUE pairs from a local .env file without adding a runtime dependency.
 */
function loadDotEnv(filePath: string): NodeJS.ProcessEnv {
  if (!existsSync(filePath)) {
    return {};
  }

  return readFileSync(filePath, "utf8")
    .split(/\r?\n/)
    .reduce<NodeJS.ProcessEnv>((env, line) => {
      const trimmed = line.trim();
      const separatorIndex = trimmed.indexOf("=");

      if (!trimmed || trimmed.startsWith("#") || separatorIndex <= 0) {
        return env;
      }

      const key = trimmed.slice(0, separatorIndex).trim();
      const rawValue = trimmed.slice(separatorIndex + 1).trim();
      env[key] = stripQuotes(rawValue);
      return env;
    }, {});
}

function stripQuotes(value: string): string {
  if (
    (value.startsWith('"') && value.endsWith('"')) ||
    (value.startsWith("'") && value.endsWith("'"))
  ) {
    return value.slice(1, -1);
  }

  return value;
}
