export type AdvisorMode = "review" | "plan";

export interface GitReviewContext {
  branch: string;
  headSha: string;
  baseRef: string;
  targetRef: string;
  compareRange: string;
  changedFiles: string[];
  uncommittedFiles: string[];
  diffStat: string;
  diffPatch: string;
  diffTruncated: boolean;
  includeUncommitted: boolean;
}

export interface PlanContextFile {
  path: string;
  content: string;
  truncated: boolean;
}

export interface ClaudeCommandInfo {
  command: string;
  args: string[];
}

export interface RunMetadata {
  schemaVersion: 1;
  runId: string;
  mode: AdvisorMode;
  model: string;
  createdAt: string;
  cwd: string;
  repoRoot: string;
  artifactDir: string;
  promptPath: string;
  outputPath: string;
  contextPath?: string;
  previousRunId?: string;
  status: "success" | "failed";
  claude: ClaudeCommandInfo & {
    exitCode?: number | null;
    signal?: NodeJS.Signals | null;
  };
  git?: GitReviewContext;
  task?: string;
  contextPaths?: string[];
  error?: {
    message: string;
    stderr?: string;
  };
}

export interface AdvisorResult {
  runId: string;
  artifactDir: string;
  promptPath: string;
  outputPath: string;
  metadataPath: string;
  output: string;
  metadata: RunMetadata;
}
