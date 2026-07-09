# AWS Control Tower SOC 2 Automation Suite

[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)
[![npm](https://img.shields.io/npm/v/@codyswann/aws-soc2-setup.svg)](https://www.npmjs.com/package/@codyswann/aws-soc2-setup)
[![SOC 2 aligned](https://img.shields.io/badge/SOC%202-aligned-green)](https://www.aicpa.org/interestareas/frc/assuranceadvisoryservices/soc2relevantguidance.html)
[![AWS Control Tower](https://img.shields.io/badge/AWS-Control%20Tower-orange)](https://aws.amazon.com/controltower/)

> Open-source TypeScript CLI for SOC 2–aligned AWS Control Tower environments

`aws-soc2-setup` turns the usual multi-day Control Tower + SOC 2 bootstrap into a guided, skip-friendly workflow: Identity Center, organizational units, security services, controls, backup, KMS, and root lockdown.

> **New here?** Durable project knowledge lives in the [LLM Wiki](wiki/start-here.md). Browse [`wiki/index.md`](wiki/index.md) or run `/onboard-me` (Codex: `$lisa-wiki-onboard-me`).

## Table of contents

- [Overview](#overview)
- [Features](#features)
- [Install](#install)
- [Quick start](#quick-start)
- [Commands](#commands)
- [Setup plan](#setup-plan)
- [Security considerations](#security-considerations)
- [Development](#development)
- [Contributing](#contributing)
- [License](#license)
- [Disclaimer](#disclaimer)

## Overview

This package is a typed Node.js CLI (`aws-soc2-setup`) published as [`@codyswann/aws-soc2-setup`](https://www.npmjs.com/package/@codyswann/aws-soc2-setup). It uses AWS SDK v3 under the hood and replaces the earlier Bash suite with the same domain coverage:

| Domain | What it covers |
| --- | --- |
| **setup** | 16-step orchestrator (plan + automatable steps) |
| **status** / **whoami** | Environment readiness and caller identity |
| **sso** | IAM Identity Center users, groups, assignments, profile config |
| **controltower** | OUs, Account Factory provisioning, Control Tower controls |
| **security** | GuardDuty, Security Hub, Config, Macie, Inspector, Audit Manager |
| **backup** | AWS Backup vault/plan + delegated admin |
| **kms** | Key administrators and rotation |
| **root** | Delete root access keys; org-wide root credential removal |

Manual console steps (root MFA, enabling Identity Center, landing zone creation) stay explicit in the plan — the CLI does not pretend those are fully automatable.

## Features

- **Guided setup** — `setup` prints the ordered plan and runs the automatable steps
- **Dry-run safe** — global `--dry-run` previews mutating work; `status` is always read-only
- **Multi-account architecture** — management, audit, log archive, and workload accounts via Control Tower
- **IAM Identity Center** — users, groups, and permission-set assignment instead of long-lived IAM users
- **SOC 2–oriented controls** — security services, Control Tower guardrails, backup, and KMS
- **Root protection** — delete root keys and remove root credentials from member accounts
- **Open source** — MIT licensed; contributions welcome

## Install

**Requirements:** Node.js 18+, AWS credentials (CLI profile or default chain), and an AWS account where you can enable Organizations / Control Tower.

```bash
# one-shot
npx @codyswann/aws-soc2-setup --help

# or install globally
npm install -g @codyswann/aws-soc2-setup
aws-soc2-setup --help
```

From a clone of this repo (Bun is the package manager):

```bash
git clone https://github.com/CodySwannGT/aws-soc2-setup.git
cd aws-soc2-setup
bun install
bun run build
./bin/aws-soc2-setup.js --help
```

## Quick start

```bash
# Confirm credentials
aws-soc2-setup whoami -p your-admin-profile

# See what the environment already has
aws-soc2-setup status -p your-admin-profile

# Preview the full setup plan (no changes)
aws-soc2-setup setup --dry-run -p your-admin-profile

# Run automatable steps (OUs, security services, optional controls/backup/audit)
aws-soc2-setup setup -p your-admin-profile \
  --ou ou-xxxx-xxxxxxxx \
  --central-account 111122223333 \
  --admin-account 444455556666 \
  --audit-account 777788889999
```

**Global options** (apply to every command):

| Flag | Description |
| --- | --- |
| `-p, --profile <profile>` | AWS CLI profile |
| `-r, --region <region>` | Region (default: `AWS_REGION` or `us-east-1`) |
| `--dry-run` | Preview mutating actions without applying them |
| `-y, --yes` | Skip confirmation prompts (required for destructive `root` ops) |

## Commands

| Command | Purpose |
| --- | --- |
| `status` | Read-only readiness: credentials, Organizations, recommended OUs, Identity Center, member accounts |
| `whoami` | Print STS caller identity |
| `setup` | Print the 16-step plan and run automatable steps |
| `sso create-user` / `group` / `assign` | Identity Center users, groups, permission sets |
| `sso configure-profile` / `set-start-url` | Local SSO profile and start URL |
| `controltower create-ous` | Create Infrastructure / Workloads / Sandbox OUs |
| `controltower provision-account` | Account Factory provisioning (`--wait` supported) |
| `controltower enable-controls` | Enable Control Tower controls for an OU |
| `security enable` | Enable GuardDuty, Security Hub, Config, Macie, Inspector |
| `security audit` | Audit Manager / SOC 2 framework / Config aggregator |
| `backup` | Configure AWS Backup (vault, plan, delegated admin) |
| `kms` | Manage key administrators and rotation |
| `root delete-keys` / `remove-access` | Root key deletion and org-wide root lockdown (`--yes` required) |

Run `aws-soc2-setup <command> --help` for flags on each subcommand.

## Setup plan

`setup` follows this sequence. Automated steps run when you invoke `setup` (with the options they need); manual steps are printed as guidance.

| # | Step | Kind |
| --- | --- | --- |
| 1 | Initial AWS CLI / SSO profile setup | Manual (`sso configure-profile`) |
| 2 | Enable MFA for the root user | Manual (console) |
| 3 | Enable IAM Identity Center | Manual (console) |
| 4 | Set up AWS Control Tower landing zone | Manual (console) |
| 5 | Create the admin user | Manual (`sso create-user`, `sso assign`, `root delete-keys`) |
| 6 | Create the initial users group | Manual (`sso group`) |
| 7 | Create additional users | Manual (`sso create-user` / `sso group`) |
| 8 | Create organizational units | Automated (`controltower create-ous --all`) |
| 9 | Enable security services | Automated (`security enable --all`) |
| 10 | Enable Control Tower controls | Automated (`controltower enable-controls`) |
| 11 | Configure AWS Backup | Automated (`backup`) |
| 12 | Configure audit and reporting | Automated (`security audit`) |
| 13 | Provision additional accounts | Manual (`controltower provision-account`) |
| 14 | Custom Identity Center domain | Manual (`sso set-start-url`) |
| 15 | Disable root access for sub-accounts | Manual (`root remove-access --yes`) |
| 16 | Configure KMS key management | Manual (`kms`) |

Track progress with [`docs/CHECKLIST.md`](docs/CHECKLIST.md).

## Security considerations

- **Root access keys** may be created temporarily during bootstrap; delete them promptly (`root delete-keys`). If a run is interrupted, remove any leftover root keys manually.
- **`root remove-access`** is destructive and requires `--yes`. Review member accounts before running it.
- **New Account Factory accounts** do not automatically inherit every security service. Re-run `security enable` (or `setup`) after provisioning.
- **Least privilege** — prefer Identity Center permission sets over long-lived IAM users; review cross-account roles regularly.
- This tool helps implement *technical* controls relevant to SOC 2. It does **not** guarantee a successful audit.

## Development

```bash
bun install
bun run build
bun run test
bun run lint
bun run typecheck
```

Source lives under `src/` (commands, domain modules, shared `lib/`). Tests mirror that layout under `tests/` (Vitest + `aws-sdk-client-mock`).

## Contributing

Contributions are welcome — see [CONTRIBUTING.md](CONTRIBUTING.md). Open issues and pull requests against [CodySwannGT/aws-soc2-setup](https://github.com/CodySwannGT/aws-soc2-setup).

## License

MIT — see [LICENSE](LICENSE).

## Disclaimer

This suite helps implement technical controls relevant to SOC 2 compliance but does not guarantee a successful audit. Work with qualified auditors for your organization's specific requirements.
