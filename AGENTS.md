# AGENTS

## Overview
This is a Standard Repository project.

## MCP Tool Usage
Always check for available MCP tools before attempting to solve a problem directly.
Prioritize using MCP tools when they can help with a task - they provide enhanced
capabilities beyond your base functionality.
@/.roo/rules/03-mcp-tools.md

## Key Files
@/package.json
@/README.md

## Coding Standards
@/.roo/rules/01-coding-standards.md

## Architecture Guide
@/.roo/rules/02-architecture-guide.md

## GitHub Copilot Compatibility
This project is configured to work alongside GitHub Copilot.
Copilot and Claude/Roo are both active; be aware of potential conflicts with inline suggestions.

## LLM Wiki
Durable project knowledge lives in `wiki/`, maintained by the `lisa-wiki` kernel.

- Rules / contract: `wiki/schema/llm-wiki-contract.md`
- Orientation: `wiki/start-here.md`
- Navigation map: `wiki/index.md`

Query the wiki first (`$lisa-wiki-query`) before answering; contribute knowledge via
`$lisa-wiki-ingest` so provenance, the index, the log, and state stay consistent. Never hand-edit
synthesis pages to add facts.

<!-- LISA_HOST_RULES_START -->
## Host Rules

Read every file under `.agents/rules/`. Make operator-requested rule edits directly; no learning-promotion step is needed.
Also read `.claude/rules/PROJECT_RULES.md`, unless your runtime auto-loads it —
Claude Code auto-loads `.claude/rules/`.
<!-- LISA_HOST_RULES_END -->

<!-- LISA_PROJECT_LEARNINGS_START -->
Antigravity startup bridge: before normal task work, resolve the canonical
machine-managed project-learnings ledger from `.lisa.config.json` (the
optional `learnings.file` override, else the default `.lisa/PROJECT_LEARNINGS.md`).
Consume it only through the Lisa learnings contract's bounded projection — never
read the raw ledger wholesale into context. If it is absent, continue silently.
If it is malformed, warn once and ignore it.

Resolved path for this project: `.lisa/PROJECT_LEARNINGS.md`.

- If you can't reach something you need, such as a repository, a secret, an API, or a connector, say exactly what's missing in your first message and stop. Don't substitute, mock, or guess.
If the missing access is discovered after work begins, say exactly what's missing in your next message and stop.
<!-- LISA_PROJECT_LEARNINGS_END -->
