import { execFileSync } from "node:child_process";
import fs from "node:fs";
import fsp from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { buildClaudeArgs, normalizeModel } from "../src/claude.js";
import { sanitizeForPath } from "../src/artifacts.js";
import { collectReviewContext, planWithAgent, reviewWork } from "../src/workflows.js";

let tempRoot: string;
let fakeBin: string;

function run(command: string, args: string[], cwd: string, env?: NodeJS.ProcessEnv): string {
  return execFileSync(command, args, {
    cwd,
    env: { ...process.env, ...env },
    encoding: "utf8",
  });
}

async function writeFile(filePath: string, content: string): Promise<void> {
  await fsp.mkdir(path.dirname(filePath), { recursive: true });
  await fsp.writeFile(filePath, content, "utf8");
}

async function createFakeClaude(expectedModel = "haiku"): Promise<string> {
  fakeBin = path.join(tempRoot, "bin");
  await fsp.mkdir(fakeBin, { recursive: true });
  const fakeClaude = path.join(fakeBin, "claude");
  await fsp.writeFile(
    fakeClaude,
    `#!/usr/bin/env node
const fs = require("node:fs");
const args = process.argv.slice(2);
const stdin = fs.readFileSync(0, "utf8");
if (!args.includes("--permission-mode") || args[args.indexOf("--permission-mode") + 1] !== "plan") {
  console.error("missing plan permission mode");
  process.exit(10);
}
if (!args.includes("--no-session-persistence")) {
  console.error("missing no session persistence");
  process.exit(11);
}
const model = args[args.indexOf("--model") + 1];
if (model !== ${JSON.stringify(expectedModel)}) {
  console.error("unexpected model " + model);
  process.exit(12);
}
console.log("# Fake Claude Output\\n\\nModel: " + model + "\\nPrompt bytes: " + Buffer.byteLength(stdin));
`,
    "utf8"
  );
  await fsp.chmod(fakeClaude, 0o755);
  return fakeClaude;
}

function createGitRepo(): string {
  const repo = path.join(tempRoot, "repo");
  fs.mkdirSync(repo, { recursive: true });
  run("git", ["init", "-b", "main"], repo);
  run("git", ["config", "user.email", "agent-advisor@example.test"], repo);
  run("git", ["config", "user.name", "Agent Advisor"], repo);
  fs.writeFileSync(path.join(repo, "README.md"), "# Test Repo\n", "utf8");
  run("git", ["add", "README.md"], repo);
  run("git", ["commit", "-m", "initial"], repo);
  run("git", ["branch", "feature"], repo);
  run("git", ["checkout", "feature"], repo);
  fs.writeFileSync(path.join(repo, "README.md"), "# Test Repo\n\nFeature line\n", "utf8");
  run("git", ["add", "README.md"], repo);
  run("git", ["commit", "-m", "feature"], repo);
  fs.writeFileSync(path.join(repo, "notes.txt"), "uncommitted\n", "utf8");
  return repo;
}

beforeEach(async () => {
  tempRoot = await fsp.mkdtemp(path.join(os.tmpdir(), "agent-advisor-"));
});

afterEach(async () => {
  await fsp.rm(tempRoot, { recursive: true, force: true });
});

describe("model and command handling", () => {
  it("defaults to sonnet but accepts user-provided models", () => {
    expect(normalizeModel()).toBe("sonnet");
    expect(normalizeModel("opus")).toBe("opus");
    expect(normalizeModel("claude-fable-5")).toBe("claude-fable-5");
  });

  it("builds Claude args with plan permission mode", () => {
    expect(buildClaudeArgs("haiku")).toEqual([
      "-p",
      "--model",
      "haiku",
      "--permission-mode",
      "plan",
      "--output-format",
      "text",
      "--no-session-persistence",
    ]);
  });

  it("sanitizes model names for artifact paths", () => {
    expect(sanitizeForPath("Claude Fable 5")).toBe("claude-fable-5");
  });
});

describe("review workflow", () => {
  it("collects branch and uncommitted diff context", async () => {
    const repo = createGitRepo();
    const context = await collectReviewContext({
      cwd: repo,
      baseRef: "main",
      model: "haiku",
    });
    expect(context.gitContext.changedFiles).toContain("README.md");
    expect(context.gitContext.uncommittedFiles).toContain("notes.txt");
    expect(context.gitContext.diffPatch).toContain("Feature line");
    expect(context.gitContext.diffPatch).toContain("uncommitted");
  });

  it("writes review artifacts using fake Claude and haiku", async () => {
    const repo = createGitRepo();
    const fakeClaude = await createFakeClaude("haiku");
    const result = await reviewWork({
      cwd: repo,
      baseRef: "main",
      model: "haiku",
      claudeCommand: fakeClaude,
    });
    expect(result.runId).toContain("review-haiku");
    expect(result.output).toContain("Fake Claude Output");
    expect(fs.existsSync(result.outputPath)).toBe(true);
    expect(fs.existsSync(path.join(repo, ".agent-advisor", ".gitignore"))).toBe(true);
    expect(result.metadata.claude.args).toContain("--permission-mode");
    expect(result.metadata.claude.args).toContain("plan");
  });
});

describe("planning workflow", () => {
  it("writes plan artifacts using fake Claude and context files", async () => {
    const repo = createGitRepo();
    const fakeClaude = await createFakeClaude("haiku");
    await writeFile(path.join(repo, "src", "example.ts"), "export const value = 1;\n");
    const result = await planWithAgent({
      cwd: repo,
      task: "Plan a tiny change",
      contextPaths: ["src/example.ts"],
      model: "haiku",
      claudeCommand: fakeClaude,
    });
    expect(result.runId).toContain("plan-haiku");
    expect(result.output).toContain("Fake Claude Output");
    expect(result.metadata.task).toBe("Plan a tiny change");
    expect(await fsp.readFile(result.promptPath, "utf8")).toContain("src/example.ts");
  });
});
