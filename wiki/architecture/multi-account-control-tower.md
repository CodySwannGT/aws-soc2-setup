---
type: architecture
created: 2026-05-28
updated: 2026-07-09
related: [projects/aws-soc2-automation-suite.md, requirements/soc2-controls.md]
sources: [sources/git/2026-05-28-aws-soc2-setup-git.md, sources/memory/2026-07-09-typescript-cli-oss.md]
sensitivity: public
---

# Multi-account AWS Control Tower architecture

## Overview
The CLI implements AWS's recommended multi-account strategy for security isolation, configuring
account relationships, permissions, and security services through typed AWS SDK v3 clients.

Source: `wiki/sources/memory/2026-07-09-typescript-cli-oss.md`.

## Account structure
- **Management account** — organization root; bootstraps the environment.
- **Audit account** — centralized audit / security tooling.
- **Log archive account** — centralized log retention.
- **Workload accounts** — provisioned via `controltower provision-account` and placed under OUs
  created with `controltower create-ous` (Infrastructure, Workloads, Sandbox).

## Identity
IAM Identity Center (SSO) for user and permission management (`sso create-user`, `sso group`,
`sso assign`, `sso configure-profile`, `sso set-start-url`).

## Security services
SOC 2–oriented services via `security enable` (GuardDuty, Security Hub, Config, Macie, Inspector),
Control Tower controls via `controltower enable-controls`, audit reporting via `security audit`,
AWS Backup via `backup`, and KMS governance via `kms`.

## Root-account protection
`root delete-keys` removes root access keys; `root remove-access` removes root credentials across
organization member accounts (destructive; requires `--yes`).

## CLI layout
`src/commands/` registers commander commands; domain logic lives in `src/{sso,security,controltower,root,kms,backup}/`; shared AWS/config/logging helpers in `src/lib/`; the ordered plan in `src/orchestrator/plan.ts`; environment probes for `status` in `src/status/`.
