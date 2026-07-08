import { runProcess } from "./process.js";

export const DEFAULT_MODEL = "sonnet";

export function normalizeModel(model?: string): string {
  const normalized = model?.trim();
  return normalized || DEFAULT_MODEL;
}

export function buildClaudeArgs(model: string): string[] {
  return [
    "-p",
    "--model",
    model,
    "--permission-mode",
    "plan",
    "--output-format",
    "text",
    "--no-session-persistence",
  ];
}

export async function runClaude(options: {
  cwd: string;
  prompt: string;
  model?: string;
  claudeCommand?: string;
  timeoutMs?: number;
}): Promise<{ output: string; command: string; args: string[]; exitCode: number | null; signal: NodeJS.Signals | null }> {
  const model = normalizeModel(options.model);
  const command = options.claudeCommand?.trim() || "claude";
  const args = buildClaudeArgs(model);
  const result = await runProcess(command, args, {
    cwd: options.cwd,
    input: options.prompt,
    timeoutMs: options.timeoutMs,
  });
  return {
    output: result.stdout.trimEnd(),
    command,
    args,
    exitCode: result.exitCode,
    signal: result.signal,
  };
}
