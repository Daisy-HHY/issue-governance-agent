import type { GovernanceTask } from "../schemas/governanceSchemas.js";

const TASK_ALIASES: Record<string, GovernanceTask> = {
  clarify: "clarify",
  dedupe: "dedupe",
  risk: "risk_report",
  risk_report: "risk_report",
  split: "split_tasks",
  split_tasks: "split_tasks",
  tests: "generate_tests",
  generate_tests: "generate_tests"
};

const COMMAND_TASKS: Record<string, GovernanceTask[]> = {
  "/issue-govern": ["dedupe", "clarify", "split_tasks", "generate_tests", "risk_report"],
  "/issue-dedupe": ["dedupe"],
  "/issue-clarify": ["clarify"],
  "/issue-split": ["split_tasks"],
  "/issue-tests": ["generate_tests"],
  "/issue-risk": ["risk_report"]
};

export interface GovernanceCommand {
  name: string;
  tasks: GovernanceTask[];
  error?: string;
}

/**
 * Parses supported GitHub issue governance slash commands.
 */
export function parseGovernanceCommand(commentBody: string): GovernanceCommand | null {
  const firstLine = commentBody.trim().split(/\r?\n/)[0]?.trim();

  if (!firstLine?.startsWith("/issue-")) {
    return null;
  }

  const [name, ...args] = firstLine.split(/\s+/);
  const defaultTasks = COMMAND_TASKS[name];

  if (!defaultTasks) {
    return {
      name,
      tasks: [],
      error: `未知治理指令：${name}`
    };
  }

  const taskArg = args.find((arg) => arg.startsWith("tasks="));
  if (!taskArg) {
    return {
      name,
      tasks: defaultTasks
    };
  }

  const parsedTasks = taskArg
    .slice("tasks=".length)
    .split(",")
    .map((task) => TASK_ALIASES[task.trim()])
    .filter(Boolean);

  return parsedTasks.length > 0
    ? {
        name,
        tasks: parsedTasks
      }
    : {
        name,
        tasks: [],
        error: `参数错误：${taskArg}`
      };
}
