import type { GitReviewContext, PlanContextFile } from "./types.js";

export function truncateText(value: string, maxBytes: number): { text: string; truncated: boolean } {
  const bytes = Buffer.byteLength(value, "utf8");
  if (bytes <= maxBytes) {
    return { text: value, truncated: false };
  }
  const buffer = Buffer.from(value, "utf8").subarray(0, maxBytes);
  return {
    text: `${buffer.toString("utf8")}\n\n[AgentAdvisor truncated content at ${maxBytes} bytes of ${bytes} bytes.]`,
    truncated: true,
  };
}

export function buildReviewPrompt(options: {
  repoRoot: string;
  model: string;
  git: GitReviewContext;
  previousOutput?: string;
}): string {
  const previous = options.previousOutput
    ? `\n## Previous AgentAdvisor Review\n\n${options.previousOutput}\n`
    : "";

  return `# AgentAdvisor Review Request

You are acting as an external advisory reviewer for Codex.

Do not edit files, commit, push, reset, check out branches, or run commands that mutate the repository.
Review only the supplied repository context and produce Markdown findings for Codex to verify.

## Repository

- Root: ${options.repoRoot}
- Branch: ${options.git.branch}
- Head: ${options.git.headSha}
- Base ref: ${options.git.baseRef}
- Target ref: ${options.git.targetRef}
- Compare range: ${options.git.compareRange}
- Include uncommitted changes: ${options.git.includeUncommitted ? "yes" : "no"}

## Output Format

Return Markdown with these sections:

1. Findings
2. Questions Or Assumptions
3. Suggested Verification

For each finding, include severity, affected file or area, rationale, and a concrete recommendation.
If there are no issues, say so clearly and still mention residual risk.
${previous}
## Changed Files

${options.git.changedFiles.length > 0 ? options.git.changedFiles.map((file) => `- ${file}`).join("\n") : "No committed branch diff files detected."}

## Uncommitted Files

${options.git.uncommittedFiles.length > 0 ? options.git.uncommittedFiles.map((file) => `- ${file}`).join("\n") : "No uncommitted files detected."}

## Diff Stat

\`\`\`text
${options.git.diffStat || "No diff stat."}
\`\`\`

## Diff Patch

\`\`\`diff
${options.git.diffPatch || "No patch content."}
\`\`\`
`;
}

export function buildPlanPrompt(options: {
  repoRoot: string;
  task: string;
  model: string;
  branch?: string;
  headSha?: string;
  contextFiles: PlanContextFile[];
  previousOutput?: string;
}): string {
  const context = options.contextFiles
    .map((file) => {
      const truncated = file.truncated ? "\n[This file was truncated by AgentAdvisor.]" : "";
      return `## Context File: ${file.path}\n\n\`\`\`text\n${file.content}${truncated}\n\`\`\``;
    })
    .join("\n\n");
  const previous = options.previousOutput
    ? `\n## Previous AgentAdvisor Output\n\n${options.previousOutput}\n`
    : "";

  return `# AgentAdvisor Planning Request

You are acting as an external advisory planner for Codex.

Do not edit files, commit, push, reset, check out branches, or run commands that mutate the repository.
Create a concrete implementation plan that Codex can verify and execute.

## Repository

- Root: ${options.repoRoot}
${options.branch ? `- Branch: ${options.branch}` : ""}
${options.headSha ? `- Head: ${options.headSha}` : ""}

## User Task

${options.task}
${previous}
## Output Format

Return Markdown with these sections:

1. Objective
2. Assumptions
3. Proposed Implementation
4. Risks And Edge Cases
5. Test Plan

Keep the plan decision-complete enough for Codex to implement, but do not include instructions to let Claude edit the repo.

${context || "No explicit context files were supplied."}
`;
}
