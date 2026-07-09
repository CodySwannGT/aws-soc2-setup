---
type: source
created: 2026-07-09
updated: 2026-07-09
system: memory
sensitivity: public
---

# Source note — TypeScript CLI and open-source packaging (2026-07-09)

## Provenance
Captured from the repository state on 2026-07-09 while aligning public docs with the
codebase. Primary evidence: `package.json`, `src/program.ts`, `src/orchestrator/plan.ts`,
`src/commands/*`, commit `35083e0` ("feat: convert AWS SOC 2 bash suite to a typed TypeScript CLI"),
and the refreshed `README.md` / `docs/CHECKLIST.md`.

## Facts
- The product is an open-source MIT-licensed TypeScript CLI published as npm package
  `@codyswann/aws-soc2-setup` with bin `aws-soc2-setup`.
- Repository: `https://github.com/CodySwannGT/aws-soc2-setup`.
- The former Bash suite (`master_control_tower_setup.sh` and related `*.sh` scripts) was removed
  in the conversion commit; domain coverage was ported to AWS SDK v3 modules under `src/`.
- Command surface: `status`, `whoami`, `setup`, `sso`, `controltower`, `security`, `backup`,
  `kms`, `root`. Global flags: `--profile`, `--region`, `--dry-run`, `--yes`.
- `setup` documents a 16-step plan (mix of manual console/CLI guidance and automated domain
  commands). Automatable steps: create OUs, enable security services, enable controls, backup,
  audit reporting.
- `status` probes caller identity, Organizations, recommended OUs (Infrastructure, Workloads,
  Sandbox), IAM Identity Center, and member-account count; it is read-only.
- Package manager for development is Bun (`engines.bun`); Node.js >= 18 for runtime.
- Tests: Vitest + `aws-sdk-client-mock`, mirrored under `tests/`.

## Non-claims
- Does not assert npm publish status beyond package metadata intent.
- Does not claim SOC 2 certification; only technical-control alignment.
