# Start here — AWS Control Tower SOC 2 Automation Suite Wiki

## Purpose
The durable knowledge base for the AWS Control Tower SOC 2 Automation Suite — a collection of interconnected scripts that automate and guide the creation of a secure, SOC 2 compliant, multi-account AWS environment using AWS Control Tower. It captures the suite's setup workflow, multi-account architecture, IAM Identity Center integration, SOC 2 security controls, organizational structure, root-account protection, and the decisions and playbooks behind them.

## What this is
A git-native LLM Wiki owned by **aws-soc2-setup** and maintained by the `lisa-wiki` kernel. It is the
durable home for this project's knowledge (and documentation). Raw sources are preserved under
`wiki/sources/`; distilled knowledge lives in the category pages; the rules are in
`wiki/schema/llm-wiki-contract.md`.

## How to use it
- **New here?** Run `/onboard-me` (Codex: `$lisa-wiki-onboard-me`) for a guided tour + sample questions.
- **Find/answer something:** `/query "<question>"` — cited answers from the wiki.
- **Add knowledge:** `/ingest <url|file|prompt>` (Codex: `$lisa-wiki-ingest`), or `/ingest` with no
  argument for a full ingest across all enabled non-external-write sources (external-write sources
  require explicit intent).
- **Browse:** [index.md](index.md).
- **Check health:** `/lint`.

## Map
Synthesis categories: concepts, entities, decisions, architecture, requirements, playbooks, open-questions, projects, sales, marketing, finance, customers, people, legal.
Sources: `wiki/sources/` · State: `wiki/state/` · Contract:
`wiki/schema/llm-wiki-contract.md` · Log: `wiki/log.md`.
