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
