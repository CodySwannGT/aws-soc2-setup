---
type: project
created: 2026-05-28
updated: 2026-05-28
related: [architecture/multi-account-control-tower.md, requirements/soc2-controls.md]
sources: [sources/git/2026-05-28-aws-soc2-setup-git.md]
sensitivity: internal
---

# AWS Control Tower SOC 2 Automation Suite

## What it is
A collection of interconnected Bash scripts that automate and guide the creation of a secure,
SOC 2 compliant, multi-account AWS environment using AWS Control Tower with minimal manual
intervention. It reduces the typically 8–16 hour manual setup into a streamlined, repeatable,
skip-friendly workflow.

## Entry point
`master_control_tower_setup.sh` orchestrates the suite. Parameters: `-a ACCOUNT_ID`,
`-p PROFILE` (default `sampleproject`), `-d ADMIN_PROFILE`, `-r REGION` (default `us-east-1`),
`-h` help. The process is skip-friendly — it can resume from any step.

## Component scripts
The suite ships focused scripts including: `configure_sso_profile.sh`, `create_sso_user.sh`,
`add_all_users_to_group.sh`, `manage_sso_group.sh`, `assign_sso_permissions.sh`,
`create_organizational_units.sh`, `provision_account.sh`, `enable_control_tower_controls.sh`,
`enable_security_services.sh`, `configure_audit_reporting.sh`, `configure_aws_backup.sh`,
`manage_kms_keys.sh`, `delete_root_user_access_key.sh`, `remove_root_access.sh`,
`update_identity_center_start_url.sh`.

## Prerequisites
AWS root account with admin access, AWS CLI configured, `jq`, a Bash shell, and basic AWS
familiarity.

## Status
Repository under `CodySwannGT/aws-soc2-setup`. Recent history added `@codyswann/lisa` as a dev
dependency (PR #1). See `sources/git/2026-05-28-aws-soc2-setup-git.md` for commit history.
