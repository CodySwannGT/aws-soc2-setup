---
type: requirement
created: 2026-05-28
updated: 2026-07-09
related: [architecture/multi-account-control-tower.md, projects/aws-soc2-automation-suite.md]
sources: [sources/git/2026-05-28-aws-soc2-setup-git.md, sources/memory/2026-07-09-typescript-cli-oss.md]
sensitivity: public
---

# SOC 2 controls implemented by the suite

The CLI codifies SOC 2–oriented technical practices so environments can start from a stronger
baseline. It does **not** certify an organization for SOC 2; auditors still evaluate people,
process, and evidence.

Source: `wiki/sources/memory/2026-07-09-typescript-cli-oss.md`.

## Controls
- **Root MFA** — setup plan guides enabling MFA on the root account (console).
- **Privileged-access management** — `root delete-keys` and `root remove-access` for sub-accounts.
- **Centralized identity** — IAM Identity Center instead of long-lived IAM users (`sso` commands).
- **Security service enablement** — GuardDuty, Security Hub, Config, Macie, Inspector (`security enable`).
- **Control Tower guardrails** — preventive/detective controls (`controltower enable-controls`).
- **Audit logging & reporting** — log archive account plus Audit Manager / Config aggregator (`security audit`).
- **Backup & key management** — AWS Backup and KMS key governance (`backup`, `kms`).

## Open questions
None recorded yet. New ambiguities discovered during ingestion belong in `wiki/open-questions/`.
