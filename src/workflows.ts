import fs from "node:fs/promises";
import path from "node:path";
import { createRunArtifactPaths, readPreviousOutput, writeRunFiles } from "./artifacts.js";
import { runClaude, normalizeModel, buildClaudeArgs } from "./claude.js";
import { readContextFiles } from "./context.js";
import {
  currentBranch,
  currentHead,
  diffWithFallback,
  git,
  requireRepoRoot,
  resolveBaseRef,
  resolveRepoRoot,
  splitGitLines,
} from "./git.js";
import { ProcessError } from "./process.js";
import { buildPlanPrompt, buildReviewPrompt, truncateText } from "./prompts.js";
import type { AdvisorResult, GitReviewContext, RunMetadata } from "./types.js";

export interface ReviewWorkInput {
  cwd?: string;
  model?: string;
  baseRef?: string;
  targetRef?: string;
  includeUncommitted?: boolean;
  previousRunId?: string;
  maxDiffBytes?: number;
  claudeCommand?: string;
  timeoutMs?: number;
}

export interface PlanWithAgentInput {
  cwd?: string;
  model?: string;
  task: string;
  contextPaths?: string[];
  previousRunId?: string;
  maxContextBytesPerFile?: number;
  claudeCommand?: string;
  timeoutMs?: number;
}

export async function collectReviewContext(input: ReviewWorkInput): Promise<{
  repoRoot: string;
  gitContext: GitReviewContext;
}> {
  const cwd = path.resolve(input.cwd ?? process.cwd());
  const repoRoot = await requireRepoRoot(cwd);
  const baseRef = await resolveBaseRef(repoRoot, input.baseRef);
  const targetRef = input.targetRef?.trim() || "HEAD";
  const branch = await currentBranch(repoRoot);
  const headSha = await currentHead(repoRoot);
  const includeUncommitted = input.includeUncommitted ?? true;

  const names = await diffWithFallback(repoRoot, baseRef, targetRef, ["--name-only"]);
  const stat = await diffWithFallback(repoRoot, baseRef, targetRef, ["--stat"]);
  const patch = await diffWithFallback(repoRoot, baseRef, targetRef, ["--find-renames"]);
  const committedPatch = patch.output;
  let uncommittedPatch = "";
  let uncommittedStat = "";
  let uncommittedFiles: string[] = [];

  if (includeUncommitted && targetRef === "HEAD") {
    const modifiedFiles = splitGitLines(await git(repoRoot, ["diff", "--name-only", "HEAD"], false));
    const untrackedFiles = splitGitLines(await git(repoRoot, ["ls-files", "--others", "--exclude-standard"], false));
    uncommittedFiles = [...modifiedFiles, ...untrackedFiles];
    uncommittedStat = await git(repoRoot, ["diff", "--stat", "HEAD"], false);
    uncommittedPatch = await git(repoRoot, ["diff", "--find-renames", "HEAD"], false);
    if (untrackedFiles.length > 0) {
      const untrackedContent = await readUntrackedFiles(repoRoot, untrackedFiles);
      uncommittedPatch = [uncommittedPatch, untrackedContent].filter(Boolean).join("\n\n");
      uncommittedStat = [
        uncommittedStat,
        `Untracked files:\n${untrackedFiles.map((file) => `  ${file}`).join("\n")}`,
      ]
        .filter(Boolean)
        .join("\n");
    }
  }

  const fullPatch = [committedPatch, uncommittedPatch && `\n# Uncommitted changes against HEAD\n${uncommittedPatch}`]
    .filter(Boolean)
    .join("\n");
  const truncatedPatch = truncateText(fullPatch, input.maxDiffBytes ?? 120_000);

  return {
    repoRoot,
    gitContext: {
      branch,
      headSha,
      baseRef,
      targetRef,
      compareRange: patch.range,
      changedFiles: splitGitLines(names.output),
      uncommittedFiles,
      diffStat: [stat.output, uncommittedStat && `Uncommitted changes:\n${uncommittedStat}`]
        .filter(Boolean)
        .join("\n\n"),
      diffPatch: truncatedPatch.text,
      diffTruncated: truncatedPatch.truncated,
      includeUncommitted,
    },
  };
}

async function readUntrackedFiles(repoRoot: string, files: string[]): Promise<string> {
  const sections: string[] = [];
  for (const file of files) {
    const resolvedPath = path.resolve(repoRoot, file);
    const relativePath = path.relative(repoRoot, resolvedPath);
    if (relativePath.startsWith("..") || path.isAbsolute(relativePath)) {
      continue;
    }
    try {
      const raw = await fs.readFile(resolvedPath, "utf8");
      const truncated = truncateText(raw, 20_000);
      sections.push(
        `# Untracked file: ${relativePath}\n\`\`\`text\n${truncated.text}\n\`\`\``
      );
    } catch {
      sections.push(`# Untracked file: ${relativePath}\n[AgentAdvisor could not read this file as UTF-8.]`);
    }
  }
  return sections.join("\n\n");
}

export async function reviewWork(input: ReviewWorkInput = {}): Promise<AdvisorResult> {
  const cwd = path.resolve(input.cwd ?? process.cwd());
  const model = normalizeModel(input.model);
  const { repoRoot, gitContext } = await collectReviewContext(input);
  const previousOutput = await readPreviousOutput(repoRoot, input.previousRunId);
  const prompt = buildReviewPrompt({ repoRoot, model, git: gitContext, previousOutput });
  const paths = await createRunArtifactPaths(repoRoot, "review", model);
  const claudeCommand = input.claudeCommand?.trim() || "claude";
  const claudeArgs = buildClaudeArgs(model);

  await fs.writeFile(paths.promptPath, prompt, "utf8");
  await fs.writeFile(paths.contextPath, `${JSON.stringify({ git: gitContext }, null, 2)}\n`, "utf8");

  try {
    const claude = await runClaude({
      cwd: repoRoot,
      prompt,
      model,
      claudeCommand,
      timeoutMs: input.timeoutMs,
    });
    const metadata: RunMetadata = {
      schemaVersion: 1,
      runId: paths.runId,
      mode: "review",
      model,
      createdAt: new Date().toISOString(),
      cwd,
      repoRoot,
      artifactDir: paths.artifactDir,
      promptPath: paths.promptPath,
      outputPath: paths.outputPath,
      contextPath: paths.contextPath,
      previousRunId: input.previousRunId,
      status: "success",
      claude: {
        command: claude.command,
        args: claude.args,
        exitCode: claude.exitCode,
        signal: claude.signal,
      },
      git: gitContext,
    };
    await writeRunFiles(paths, prompt, claude.output, metadata, { git: gitContext });
    return {
      runId: paths.runId,
      artifactDir: paths.artifactDir,
      promptPath: paths.promptPath,
      outputPath: paths.outputPath,
      metadataPath: paths.metadataPath,
      output: claude.output,
      metadata,
    };
  } catch (error) {
    const processError = error instanceof ProcessError ? error : undefined;
    const output = processError?.result.stderr || String(error);
    const metadata: RunMetadata = {
      schemaVersion: 1,
      runId: paths.runId,
      mode: "review",
      model,
      createdAt: new Date().toISOString(),
      cwd,
      repoRoot,
      artifactDir: paths.artifactDir,
      promptPath: paths.promptPath,
      outputPath: paths.outputPath,
      contextPath: paths.contextPath,
      previousRunId: input.previousRunId,
      status: "failed",
      claude: {
        command: claudeCommand,
        args: claudeArgs,
        exitCode: processError?.result.exitCode,
        signal: processError?.result.signal,
      },
      git: gitContext,
      error: {
        message: String(error),
        stderr: processError?.result.stderr,
      },
    };
    await writeRunFiles(paths, prompt, output, metadata, { git: gitContext });
    throw new Error(`AgentAdvisor review failed; artifacts were written to ${paths.artifactDir}: ${error}`);
  }
}

export async function planWithAgent(input: PlanWithAgentInput): Promise<AdvisorResult> {
  const cwd = path.resolve(input.cwd ?? process.cwd());
  const repoRoot = (await resolveRepoRoot(cwd)) ?? cwd;
  const model = normalizeModel(input.model);
  const contextFiles = await readContextFiles(repoRoot, input.contextPaths, input.maxContextBytesPerFile);
  const previousOutput = await readPreviousOutput(repoRoot, input.previousRunId);
  let branch: string | undefined;
  let headSha: string | undefined;
  if (await resolveRepoRoot(cwd)) {
    branch = await currentBranch(repoRoot);
    headSha = await currentHead(repoRoot);
  }
  const prompt = buildPlanPrompt({
    repoRoot,
    task: input.task,
    model,
    branch,
    headSha,
    contextFiles,
    previousOutput,
  });
  const paths = await createRunArtifactPaths(repoRoot, "plan", model);
  const claudeCommand = input.claudeCommand?.trim() || "claude";
  const claudeArgs = buildClaudeArgs(model);
  const context = { task: input.task, contextFiles };

  await fs.writeFile(paths.promptPath, prompt, "utf8");
  await fs.writeFile(paths.contextPath, `${JSON.stringify(context, null, 2)}\n`, "utf8");

  try {
    const claude = await runClaude({
      cwd: repoRoot,
      prompt,
      model,
      claudeCommand,
      timeoutMs: input.timeoutMs,
    });
    const metadata: RunMetadata = {
      schemaVersion: 1,
      runId: paths.runId,
      mode: "plan",
      model,
      createdAt: new Date().toISOString(),
      cwd,
      repoRoot,
      artifactDir: paths.artifactDir,
      promptPath: paths.promptPath,
      outputPath: paths.outputPath,
      contextPath: paths.contextPath,
      previousRunId: input.previousRunId,
      status: "success",
      claude: {
        command: claude.command,
        args: claude.args,
        exitCode: claude.exitCode,
        signal: claude.signal,
      },
      task: input.task,
      contextPaths: input.contextPaths,
    };
    await writeRunFiles(paths, prompt, claude.output, metadata, context);
    return {
      runId: paths.runId,
      artifactDir: paths.artifactDir,
      promptPath: paths.promptPath,
      outputPath: paths.outputPath,
      metadataPath: paths.metadataPath,
      output: claude.output,
      metadata,
    };
  } catch (error) {
    const processError = error instanceof ProcessError ? error : undefined;
    const output = processError?.result.stderr || String(error);
    const metadata: RunMetadata = {
      schemaVersion: 1,
      runId: paths.runId,
      mode: "plan",
      model,
      createdAt: new Date().toISOString(),
      cwd,
      repoRoot,
      artifactDir: paths.artifactDir,
      promptPath: paths.promptPath,
      outputPath: paths.outputPath,
      contextPath: paths.contextPath,
      previousRunId: input.previousRunId,
      status: "failed",
      claude: {
        command: claudeCommand,
        args: claudeArgs,
        exitCode: processError?.result.exitCode,
        signal: processError?.result.signal,
      },
      task: input.task,
      contextPaths: input.contextPaths,
      error: {
        message: String(error),
        stderr: processError?.result.stderr,
      },
    };
    await writeRunFiles(paths, prompt, output, metadata, context);
    throw new Error(`AgentAdvisor planning failed; artifacts were written to ${paths.artifactDir}: ${error}`);
  }
}

export async function listRuns(input: { cwd?: string; limit?: number } = {}): Promise<RunMetadata[]> {
  const cwd = path.resolve(input.cwd ?? process.cwd());
  const repoRoot = (await resolveRepoRoot(cwd)) ?? cwd;
  const runsDir = path.join(repoRoot, ".agent-advisor", "runs");
  const limit = input.limit ?? 10;
  let entries: string[];
  try {
    entries = await fs.readdir(runsDir);
  } catch {
    return [];
  }
  const metadata: RunMetadata[] = [];
  for (const entry of entries.sort().reverse()) {
    if (metadata.length >= limit) {
      break;
    }
    try {
      const raw = await fs.readFile(path.join(runsDir, entry, "metadata.json"), "utf8");
      metadata.push(JSON.parse(raw) as RunMetadata);
    } catch {
      // Ignore incomplete run directories.
    }
  }
  return metadata;
}

export async function readRun(input: { cwd?: string; runId: string }): Promise<{
  metadata: RunMetadata;
  output: string;
  prompt: string;
}> {
  const cwd = path.resolve(input.cwd ?? process.cwd());
  const repoRoot = (await resolveRepoRoot(cwd)) ?? cwd;
  const runDir = path.join(repoRoot, ".agent-advisor", "runs", input.runId);
  const [metadataRaw, output, prompt] = await Promise.all([
    fs.readFile(path.join(runDir, "metadata.json"), "utf8"),
    fs.readFile(path.join(runDir, "output.md"), "utf8"),
    fs.readFile(path.join(runDir, "prompt.md"), "utf8"),
  ]);
  return {
    metadata: JSON.parse(metadataRaw) as RunMetadata,
    output,
    prompt,
  };
}
