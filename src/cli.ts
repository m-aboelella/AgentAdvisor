#!/usr/bin/env node
import { listRuns, planWithAgent, readRun, reviewWork } from "./workflows.js";

interface ParsedArgs {
  command?: string;
  flags: Map<string, string[]>;
}

function parseArgs(argv: string[]): ParsedArgs {
  const [command, ...rest] = argv;
  const flags = new Map<string, string[]>();
  for (let index = 0; index < rest.length; index += 1) {
    const token = rest[index];
    if (!token.startsWith("--")) {
      throw new Error(`Unexpected argument: ${token}`);
    }
    const name = token.slice(2);
    const value = rest[index + 1]?.startsWith("--") || rest[index + 1] === undefined ? "true" : rest[++index];
    const values = flags.get(name) ?? [];
    values.push(value);
    flags.set(name, values);
  }
  return { command, flags };
}

function getFlag(flags: Map<string, string[]>, name: string): string | undefined {
  return flags.get(name)?.at(-1);
}

function getFlagList(flags: Map<string, string[]>, name: string): string[] {
  return flags.get(name) ?? [];
}

function printHelp(): void {
  console.log(`AgentAdvisor

Usage:
  agent-advisor review [--model sonnet] [--base origin/main] [--target HEAD]
  agent-advisor plan --task "..." [--model opus] [--context src/file.ts]
  agent-advisor list-runs [--limit 10]
  agent-advisor read-run --run-id <id>

Claude runs in --permission-mode plan and writes artifacts to .agent-advisor/runs/.
`);
}

function printResult(result: { runId: string; artifactDir: string; outputPath: string; output: string }): void {
  console.log(`# AgentAdvisor ${result.runId}`);
  console.log("");
  console.log(`Artifact directory: ${result.artifactDir}`);
  console.log(`Output: ${result.outputPath}`);
  console.log("");
  console.log(result.output);
}

async function main(): Promise<void> {
  const parsed = parseArgs(process.argv.slice(2));
  if (!parsed.command || parsed.command === "help" || getFlag(parsed.flags, "help")) {
    printHelp();
    return;
  }

  if (parsed.command === "review") {
    const result = await reviewWork({
      model: getFlag(parsed.flags, "model"),
      baseRef: getFlag(parsed.flags, "base") ?? getFlag(parsed.flags, "base-ref"),
      targetRef: getFlag(parsed.flags, "target") ?? getFlag(parsed.flags, "target-ref"),
      previousRunId: getFlag(parsed.flags, "previous-run-id"),
      includeUncommitted: getFlag(parsed.flags, "include-uncommitted") !== "false",
      claudeCommand: getFlag(parsed.flags, "claude-command"),
    });
    printResult(result);
    return;
  }

  if (parsed.command === "plan") {
    const task = getFlag(parsed.flags, "task");
    if (!task) {
      throw new Error("plan requires --task");
    }
    const result = await planWithAgent({
      task,
      model: getFlag(parsed.flags, "model"),
      contextPaths: getFlagList(parsed.flags, "context"),
      previousRunId: getFlag(parsed.flags, "previous-run-id"),
      claudeCommand: getFlag(parsed.flags, "claude-command"),
    });
    printResult(result);
    return;
  }

  if (parsed.command === "list-runs") {
    const runs = await listRuns({ limit: Number(getFlag(parsed.flags, "limit") ?? 10) });
    console.log(JSON.stringify(runs, null, 2));
    return;
  }

  if (parsed.command === "read-run") {
    const runId = getFlag(parsed.flags, "run-id");
    if (!runId) {
      throw new Error("read-run requires --run-id");
    }
    const run = await readRun({ runId });
    console.log(run.output);
    return;
  }

  throw new Error(`Unknown command: ${parsed.command}`);
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
