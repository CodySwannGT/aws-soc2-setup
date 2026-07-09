---
type: project
created: 2026-05-28
updated: 2026-07-09
related: [architecture/multi-account-control-tower.md, requirements/soc2-controls.md]
sources: [sources/git/2026-05-28-aws-soc2-setup-git.md, sources/memory/2026-07-09-typescript-cli-oss.md]
sensitivity: public
---

# AWS Control Tower SOC 2 Automation Suite

## What it is
An open-source TypeScript CLI (`aws-soc2-setup`, npm package `@codyswann/aws-soc2-setup`) that
automates and guides creation of a SOC 2–aligned multi-account AWS environment using AWS Control
Tower. It replaces the earlier Bash suite with AWS SDK v3 domain modules while keeping the same
skip-friendly, step-ordered workflow.

Source: `wiki/sources/memory/2026-07-09-typescript-cli-oss.md`.

## Entry point
Binary: `aws-soc2-setup` (local: `./bin/aws-soc2-setup.js` after `bun run build`).

Global options: `-p/--profile`, `-r/--region`, `--dry-run`, `-y/--yes`.

Primary orchestrator: `aws-soc2-setup setup` — prints the 16-step plan and runs automatable steps.
Readiness: `aws-soc2-setup status`. Identity preflight: `aws-soc2-setup whoami`.

## Command domains
| Domain | Role |
| --- | --- |
| `sso` | IAM Identity Center users, groups, assignments, profile / start URL |
| `controltower` | OUs, Account Factory provisioning, Control Tower controls |
| `security` | GuardDuty, Security Hub, Config, Macie, Inspector, Audit Manager |
| `backup` | AWS Backup vault/plan and delegated admin |
| `kms` | Key administrators and rotation |
| `root` | Delete root access keys; org-wide root credential removal |

## Prerequisites
Node.js 18+, AWS credentials (CLI profile or default chain), and an account where Organizations /
Control Tower can be enabled. Development uses Bun.

## Status
Repository `CodySwannGT/aws-soc2-setup`. Published as open source under the MIT license. Bash
scripts were removed in the TypeScript conversion (`35083e0`).
