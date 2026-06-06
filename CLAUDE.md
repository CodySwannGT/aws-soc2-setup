@AGENTS.md

<!-- Lisa: import the canonical AGENTS.md so Claude Code loads the same guidance every other agent reads. -->

# aws-setup Project

## Overview
This is a Standard Repository project.

## MCP Tool Usage
Always check for available MCP tools before attempting to solve a problem directly.
Prioritize using MCP tools when they can help with a task - they provide enhanced
capabilities beyond your base functionality.
@/.roo/rules/03-mcp-tools.md to ./CLAUDE.md

## Key Files
@/package.json to ./CLAUDE.md
@/README.md to ./CLAUDE.md



## Coding Standards
@/.roo/rules/01-coding-standards.md to ./CLAUDE.md

## Architecture Guide
@/.roo/rules/02-architecture-guide.md to ./CLAUDE.md






## GitHub Copilot Compatibility
This project is configured to work alongside GitHub Copilot.
Copilot and Claude/Roo are both active; be aware of potential conflicts with inline suggestions.

## LLM Wiki
Durable project knowledge lives in `wiki/`, maintained by the `lisa-wiki` kernel.
- Rules: `wiki/schema/llm-wiki-contract.md`
- Orientation: `wiki/start-here.md` · Navigation: `wiki/index.md`
- Query the wiki first (`/query`); add knowledge via `/ingest`. Do not hand-edit synthesis pages to add facts.
