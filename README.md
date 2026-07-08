# AgentAdvisor

Use Claude Code from inside Codex as an advisory reviewer and planner.

AgentAdvisor is a local Codex plugin that exposes MCP tools for two loops:

- ask a selected Claude model to review current work
- ask a selected Claude model to draft an implementation plan for Codex to execute

Claude runs in `--permission-mode plan` and writes Markdown artifacts under
`.agent-advisor/runs/`. Codex remains the only actor that edits code.

## Local CLI

Prerequisites: Node.js 20 or newer, plus a locally installed and authenticated
`claude` CLI on `PATH`.

```bash
npm install
npm run build
npm test

node dist/cli.js review --model sonnet --base origin/main
node dist/cli.js plan --model opus --task "Plan a small README update"
node dist/cli.js list-runs --limit 5
node dist/cli.js read-run --run-id <run-id>
```

Use `node dist/cli.js --help` for the full CLI surface. `list-runs` and
`read-run` inspect prior artifacts under `.agent-advisor/runs/`.

## Personal Codex Plugin

```bash
npm run install:personal
codex plugin add agent-advisor@personal
```

Start a new Codex thread after installing or updating the plugin so Codex can
load the bundled skill and MCP server.
