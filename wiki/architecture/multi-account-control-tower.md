---
type: architecture
created: 2026-05-28
updated: 2026-05-28
related: [projects/aws-soc2-automation-suite.md, requirements/soc2-controls.md]
sources: [sources/git/2026-05-28-aws-soc2-setup-git.md]
sensitivity: internal
---

# Multi-account AWS Control Tower architecture

## Overview
The suite implements AWS's recommended multi-account strategy for security isolation, configuring
account relationships, permissions, and security services automatically.

## Account structure
- **Management account** — the organization root; bootstraps the environment.
- **Audit account** — centralized audit / security tooling.
- **Log archive account** — centralized log retention.
- **Workload accounts** — provisioned via `provision_account.sh` and registered into the proper OUs
  (`create_organizational_units.sh`).

## Identity
IAM Identity Center (SSO) is integrated for automated user and permission management
(`configure_sso_profile.sh`, `create_sso_user.sh`, `assign_sso_permissions.sh`,
`manage_sso_group.sh`, `add_all_users_to_group.sh`).

## Security services
Required SOC 2 security services are enabled automatically (`enable_security_services.sh`),
along with Control Tower controls/guardrails (`enable_control_tower_controls.sh`), audit reporting
(`configure_audit_reporting.sh`), AWS Backup (`configure_aws_backup.sh`), and KMS key management
(`manage_kms_keys.sh`).

## Root-account protection
Console access for root users in sub-accounts is disabled and root access keys removed
(`remove_root_access.sh`, `delete_root_user_access_key.sh`), satisfying SOC 2 privileged-access
requirements.
