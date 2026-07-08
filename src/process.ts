import { spawn } from "node:child_process";

export interface ProcessResult {
  stdout: string;
  stderr: string;
  exitCode: number | null;
  signal: NodeJS.Signals | null;
}

export class ProcessError extends Error {
  readonly result: ProcessResult;

  constructor(command: string, args: string[], result: ProcessResult) {
    super(
      `${command} ${args.join(" ")} failed with ${
        result.exitCode === null ? `signal ${result.signal}` : `exit code ${result.exitCode}`
      }`
    );
    this.name = "ProcessError";
    this.result = result;
  }
}

export async function runProcess(
  command: string,
  args: string[],
  options: {
    cwd: string;
    input?: string;
    env?: NodeJS.ProcessEnv;
    timeoutMs?: number;
    rejectOnNonZero?: boolean;
  }
): Promise<ProcessResult> {
  const timeoutMs = options.timeoutMs ?? 600_000;
  const child = spawn(command, args, {
    cwd: options.cwd,
    env: { ...process.env, ...options.env },
    stdio: ["pipe", "pipe", "pipe"],
  });

  let stdout = "";
  let stderr = "";
  let didTimeout = false;

  const timer = setTimeout(() => {
    didTimeout = true;
    child.kill("SIGTERM");
  }, timeoutMs);

  child.stdout.setEncoding("utf8");
  child.stderr.setEncoding("utf8");
  child.stdout.on("data", (chunk) => {
    stdout += chunk;
  });
  child.stderr.on("data", (chunk) => {
    stderr += chunk;
  });

  if (options.input !== undefined) {
    child.stdin.end(options.input);
  } else {
    child.stdin.end();
  }

  return await new Promise((resolve, reject) => {
    child.on("error", (error) => {
      clearTimeout(timer);
      reject(error);
    });
    child.on("close", (exitCode, signal) => {
      clearTimeout(timer);
      const result = {
        stdout,
        stderr: didTimeout ? `${stderr}\nTimed out after ${timeoutMs}ms.` : stderr,
        exitCode,
        signal,
      };
      if ((options.rejectOnNonZero ?? true) && exitCode !== 0) {
        reject(new ProcessError(command, args, result));
        return;
      }
      resolve(result);
    });
  });
}
