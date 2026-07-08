import path from "node:path";
import { runProcess } from "./process.js";

export async function resolveRepoRoot(cwd: string): Promise<string | null> {
  const result = await runProcess("git", ["rev-parse", "--show-toplevel"], {
    cwd,
    rejectOnNonZero: false,
  });
  if (result.exitCode !== 0) {
    return null;
  }
  return path.resolve(cwd, result.stdout.trim());
}

export async function requireRepoRoot(cwd: string): Promise<string> {
  const repoRoot = await resolveRepoRoot(cwd);
  if (!repoRoot) {
    throw new Error(`AgentAdvisor review requires a git repository: ${cwd}`);
  }
  return repoRoot;
}

export async function git(repoRoot: string, args: string[], rejectOnNonZero = true): Promise<string> {
  const result = await runProcess("git", args, {
    cwd: repoRoot,
    rejectOnNonZero,
  });
  return result.stdout.trimEnd();
}

export async function gitSucceeds(repoRoot: string, args: string[]): Promise<boolean> {
  const result = await runProcess("git", args, {
    cwd: repoRoot,
    rejectOnNonZero: false,
  });
  return result.exitCode === 0;
}

export async function resolveBaseRef(repoRoot: string, explicitBaseRef?: string): Promise<string> {
  if (explicitBaseRef) {
    return explicitBaseRef;
  }
  for (const candidate of ["origin/main", "main", "origin/master", "master"]) {
    if (await gitSucceeds(repoRoot, ["rev-parse", "--verify", `${candidate}^{commit}`])) {
      return candidate;
    }
  }
  throw new Error("Could not resolve a default base ref. Pass base_ref explicitly.");
}

export async function currentBranch(repoRoot: string): Promise<string> {
  const branch = await git(repoRoot, ["branch", "--show-current"], false);
  return branch || "detached";
}

export async function currentHead(repoRoot: string): Promise<string> {
  return await git(repoRoot, ["rev-parse", "--short", "HEAD"]);
}

export function splitGitLines(value: string): string[] {
  return value
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean);
}

export async function diffWithFallback(
  repoRoot: string,
  baseRef: string,
  targetRef: string,
  extraArgs: string[]
): Promise<{ output: string; range: string }> {
  const tripleRange = `${baseRef}...${targetRef}`;
  const triple = await runProcess("git", ["diff", ...extraArgs, tripleRange], {
    cwd: repoRoot,
    rejectOnNonZero: false,
  });
  if (triple.exitCode === 0) {
    return { output: triple.stdout.trimEnd(), range: tripleRange };
  }

  const doubleRange = `${baseRef}..${targetRef}`;
  const double = await runProcess("git", ["diff", ...extraArgs, doubleRange], {
    cwd: repoRoot,
    rejectOnNonZero: false,
  });
  if (double.exitCode === 0) {
    return { output: double.stdout.trimEnd(), range: doubleRange };
  }

  throw new Error(
    `Could not diff ${tripleRange} or ${doubleRange}.\n${triple.stderr}\n${double.stderr}`.trim()
  );
}
