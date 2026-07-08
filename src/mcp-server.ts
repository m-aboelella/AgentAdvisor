#!/usr/bin/env node
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import { listRuns, planWithAgent, readRun, reviewWork } from "./workflows.js";

const server = new McpServer(
  {
    name: "agent-advisor",
    version: "0.1.0",
  },
  {
    instructions:
      "AgentAdvisor invokes local Claude Code in plan permission mode for advisory review and planning. Claude must not edit code; verify advice before acting.",
  }
);

function jsonText(value: unknown) {
  return {
    content: [
      {
        type: "text" as const,
        text: JSON.stringify(value, null, 2),
      },
    ],
  };
}

server.registerTool(
  "review_work",
  {
    title: "Review Work",
    description: "Ask a selected Claude model to review current git work and write Markdown artifacts.",
    inputSchema: {
      cwd: z.string().optional().describe("Working directory for the target repository."),
      model: z.string().optional().describe("Claude model alias or full model ID. Defaults to sonnet."),
      base_ref: z.string().optional().describe("Base git ref. Defaults to origin/main, main, origin/master, or master."),
      target_ref: z.string().optional().describe("Target git ref. Defaults to HEAD."),
      include_uncommitted: z.boolean().optional().describe("Include working tree changes when target_ref is HEAD."),
      previous_run_id: z.string().optional().describe("Prior AgentAdvisor run id to include for iteration context."),
      max_diff_bytes: z.number().int().positive().optional().describe("Maximum diff bytes included in the Claude prompt."),
      claude_command: z.string().optional().describe("Claude executable path. Defaults to claude."),
      timeout_ms: z.number().int().positive().optional().describe("Claude invocation timeout in milliseconds."),
    },
  },
  async (input) => {
    const result = await reviewWork({
      cwd: input.cwd,
      model: input.model,
      baseRef: input.base_ref,
      targetRef: input.target_ref,
      includeUncommitted: input.include_uncommitted,
      previousRunId: input.previous_run_id,
      maxDiffBytes: input.max_diff_bytes,
      claudeCommand: input.claude_command,
      timeoutMs: input.timeout_ms,
    });
    return jsonText({
      run_id: result.runId,
      artifact_dir: result.artifactDir,
      output_path: result.outputPath,
      metadata_path: result.metadataPath,
      output_preview: result.output.slice(0, 4000),
    });
  }
);

server.registerTool(
  "plan_with_agent",
  {
    title: "Plan With Agent",
    description: "Ask a selected Claude model to create a Markdown implementation plan for Codex.",
    inputSchema: {
      cwd: z.string().optional().describe("Working directory for the target repository."),
      task: z.string().min(1).describe("Task for the advisory model to plan."),
      model: z.string().optional().describe("Claude model alias or full model ID. Defaults to sonnet."),
      context_paths: z.array(z.string()).optional().describe("Repository file paths to include as planning context."),
      previous_run_id: z.string().optional().describe("Prior AgentAdvisor run id to include for iteration context."),
      max_context_bytes_per_file: z.number().int().positive().optional().describe("Maximum bytes per context file."),
      claude_command: z.string().optional().describe("Claude executable path. Defaults to claude."),
      timeout_ms: z.number().int().positive().optional().describe("Claude invocation timeout in milliseconds."),
    },
  },
  async (input) => {
    const result = await planWithAgent({
      cwd: input.cwd,
      task: input.task,
      model: input.model,
      contextPaths: input.context_paths,
      previousRunId: input.previous_run_id,
      maxContextBytesPerFile: input.max_context_bytes_per_file,
      claudeCommand: input.claude_command,
      timeoutMs: input.timeout_ms,
    });
    return jsonText({
      run_id: result.runId,
      artifact_dir: result.artifactDir,
      output_path: result.outputPath,
      metadata_path: result.metadataPath,
      output_preview: result.output.slice(0, 4000),
    });
  }
);

server.registerTool(
  "list_runs",
  {
    title: "List Runs",
    description: "List recent AgentAdvisor runs for the current repository.",
    inputSchema: {
      cwd: z.string().optional().describe("Working directory for the target repository."),
      limit: z.number().int().positive().optional().describe("Maximum number of runs to return."),
    },
  },
  async (input) => {
    const runs = await listRuns({ cwd: input.cwd, limit: input.limit });
    return jsonText({ runs });
  }
);

server.registerTool(
  "read_run",
  {
    title: "Read Run",
    description: "Read an AgentAdvisor run's Markdown output and metadata.",
    inputSchema: {
      cwd: z.string().optional().describe("Working directory for the target repository."),
      run_id: z.string().min(1).describe("AgentAdvisor run id."),
    },
  },
  async (input) => {
    const run = await readRun({ cwd: input.cwd, runId: input.run_id });
    return jsonText({
      metadata: run.metadata,
      output: run.output,
      prompt: run.prompt,
    });
  }
);

const transport = new StdioServerTransport();
await server.connect(transport);
