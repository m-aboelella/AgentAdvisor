import fs from "node:fs/promises";
import path from "node:path";
import { truncateText } from "./prompts.js";
import type { PlanContextFile } from "./types.js";

export async function readContextFiles(
  repoRoot: string,
  contextPaths: string[] = [],
  maxBytesPerFile = 40_000
): Promise<PlanContextFile[]> {
  const files: PlanContextFile[] = [];
  for (const requestedPath of contextPaths) {
    const resolvedPath = path.resolve(repoRoot, requestedPath);
    const relativePath = path.relative(repoRoot, resolvedPath);
    if (relativePath.startsWith("..") || path.isAbsolute(relativePath)) {
      throw new Error(`Context path must stay inside the repository: ${requestedPath}`);
    }
    const stat = await fs.stat(resolvedPath);
    if (!stat.isFile()) {
      throw new Error(`Context path must be a file: ${requestedPath}`);
    }
    const raw = await fs.readFile(resolvedPath, "utf8");
    const truncated = truncateText(raw, maxBytesPerFile);
    files.push({
      path: relativePath,
      content: truncated.text,
      truncated: truncated.truncated,
    });
  }
  return files;
}
