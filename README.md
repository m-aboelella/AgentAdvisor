# AgentAdvisor

Use Claude Code from inside Codex as an advisory reviewer and planner.

AgentAdvisor is a local Codex plugin. After you install it, you can stay inside
Codex and ask another Claude Code model to:

- ask a selected Claude model to review current work
- ask a selected Claude model to draft an implementation plan for Codex to execute

Claude runs in `--permission-mode plan` and writes Markdown artifacts under
`.agent-advisor/runs/`. Codex remains the only actor that edits code.

## Install For Codex

Prerequisites: Node.js 20 or newer, plus a locally installed and authenticated
`claude` CLI on `PATH`.

```bash
npm install
npm run build
npm run install:personal
codex plugin add agent-advisor@personal
```

Start a new Codex thread after installing or updating the plugin so Codex can
load the bundled skill and MCP server.

## Use From Codex

Once the plugin is loaded, ask Codex naturally:

```text
Ask Sonnet to review my current branch.
Ask Opus to plan the authentication refactor before you implement it.
Ask Fable to review the last AgentAdvisor run and focus on remaining issues.
```

Codex calls the AgentAdvisor MCP tools directly. The normal flow is:

```text
Codex request -> AgentAdvisor MCP tool -> local claude CLI -> Markdown artifact -> Codex reads and acts
```

The plugin does not ask Claude to edit files, commit, push, reset, or check out
branches. Claude is an advisor; Codex verifies the output and performs any code
changes.

## Optional CLI

The local CLI is for contributors, debugging, and one-off manual runs. It uses
the same shared workflow code as the MCP server, but Codex does not normally
call it.

```bash
npm test

node dist/cli.js review --model sonnet --base origin/main
node dist/cli.js plan --model opus --task "Plan a small README update"
node dist/cli.js list-runs --limit 5
node dist/cli.js read-run --run-id <run-id>
```

Use `node dist/cli.js --help` for the full CLI surface. `list-runs` and
`read-run` inspect prior artifacts under `.agent-advisor/runs/`.
