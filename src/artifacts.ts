import fs from "node:fs/promises";
import path from "node:path";
import type { AdvisorMode, RunMetadata } from "./types.js";

export interface RunArtifactPaths {
  runId: string;
  artifactDir: string;
  metadataPath: string;
  promptPath: string;
  outputPath: string;
  contextPath: string;
}

export function sanitizeForPath(value: string): string {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9._-]+/g, "-")
    .replace(/-{2,}/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 80) || "model";
}

export async function ensureArtifactIgnore(repoRoot: string): Promise<void> {
  const advisorDir = path.join(repoRoot, ".agent-advisor");
  await fs.mkdir(advisorDir, { recursive: true });
  const ignorePath = path.join(advisorDir, ".gitignore");
  try {
    await fs.access(ignorePath);
  } catch {
    await fs.writeFile(ignorePath, "runs/\n!.gitignore\n", "utf8");
  }
}

export async function createRunArtifactPaths(
  repoRoot: string,
  mode: AdvisorMode,
  model: string,
  now = new Date()
): Promise<RunArtifactPaths> {
  await ensureArtifactIgnore(repoRoot);
  const timestamp = now.toISOString().replace(/[-:]/g, "").replace(/\.\d{3}Z$/, "Z");
  const baseRunId = `${timestamp}-${mode}-${sanitizeForPath(model)}`;
  const runsDir = path.join(repoRoot, ".agent-advisor", "runs");
  await fs.mkdir(runsDir, { recursive: true });

  for (let index = 0; index < 100; index += 1) {
    const runId = index === 0 ? baseRunId : `${baseRunId}-${index + 1}`;
    const artifactDir = path.join(runsDir, runId);
    try {
      await fs.mkdir(artifactDir);
      return {
        runId,
        artifactDir,
        metadataPath: path.join(artifactDir, "metadata.json"),
        promptPath: path.join(artifactDir, "prompt.md"),
        outputPath: path.join(artifactDir, "output.md"),
        contextPath: path.join(artifactDir, "context.json"),
      };
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "EEXIST") {
        throw error;
      }
    }
  }
  throw new Error(`Could not create a unique AgentAdvisor run directory for ${baseRunId}`);
}

export async function writeJsonFile(filePath: string, payload: unknown): Promise<void> {
  await fs.writeFile(filePath, `${JSON.stringify(payload, null, 2)}\n`, "utf8");
}

export async function writeRunFiles(
  paths: RunArtifactPaths,
  prompt: string,
  output: string,
  metadata: RunMetadata,
  context?: unknown
): Promise<void> {
  await fs.writeFile(paths.promptPath, prompt, "utf8");
  await fs.writeFile(paths.outputPath, output, "utf8");
  if (context !== undefined) {
    await writeJsonFile(paths.contextPath, context);
  }
  await writeJsonFile(paths.metadataPath, metadata);
}

export async function findRunDir(repoRoot: string, runId: string): Promise<string> {
  const runDir = path.join(repoRoot, ".agent-advisor", "runs", runId);
  const stat = await fs.stat(runDir);
  if (!stat.isDirectory()) {
    throw new Error(`AgentAdvisor run is not a directory: ${runId}`);
  }
  return runDir;
}

export async function readPreviousOutput(repoRoot: string, runId?: string): Promise<string | undefined> {
  if (!runId) {
    return undefined;
  }
  const runDir = await findRunDir(repoRoot, runId);
  return await fs.readFile(path.join(runDir, "output.md"), "utf8");
}
