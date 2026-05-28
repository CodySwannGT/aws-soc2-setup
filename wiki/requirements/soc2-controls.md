---
type: requirement
created: 2026-05-28
updated: 2026-05-28
related: [architecture/multi-account-control-tower.md, projects/aws-soc2-automation-suite.md]
sources: [sources/git/2026-05-28-aws-soc2-setup-git.md]
sensitivity: internal
---

# SOC 2 controls implemented by the suite

The suite codifies SOC 2 best practices so the environment is compliant from day one (SOC 2 audits
examine historical compliance, so a compliant foundation avoids retroactive fixes).

## Controls
- **Root MFA** — guides setup of Multi-Factor Authentication on the root account.
- **Privileged-access management** — disables sub-account root console access and removes root access
  keys.
- **Centralized identity** — IAM Identity Center for user/permission management instead of long-lived
  IAM users.
- **Security service enablement** — automatic enablement of required AWS security services.
- **Control Tower guardrails** — preventive/detective controls enabled across the organization.
- **Audit logging & reporting** — centralized log archive account plus audit reporting.
- **Backup & key management** — AWS Backup and KMS key governance.

## Open questions
None recorded yet. New ambiguities discovered during ingestion belong in `wiki/open-questions/`.
