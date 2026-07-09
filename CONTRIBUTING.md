# Contributing to AWS Control Tower SOC 2 Automation Suite

Thank you for considering a contribution. This project is an open-source TypeScript CLI (`aws-soc2-setup`) that helps teams bootstrap SOC 2–aligned AWS Control Tower environments.

By participating, you agree to uphold our [Code of Conduct](CODE_OF_CONDUCT.md).

## Table of contents

- [Getting started](#getting-started)
- [How to contribute](#how-to-contribute)
- [Development workflow](#development-workflow)
- [Coding standards](#coding-standards)
- [Testing](#testing)
- [Security](#security)
- [Documentation](#documentation)

## Getting started

1. Fork [CodySwannGT/aws-soc2-setup](https://github.com/CodySwannGT/aws-soc2-setup).
2. Clone your fork and add upstream:
   ```bash
   git clone https://github.com/<you>/aws-soc2-setup.git
   cd aws-soc2-setup
   git remote add upstream https://github.com/CodySwannGT/aws-soc2-setup.git
   ```
3. Install with Bun (required by `package.json` engines):
   ```bash
   bun install
   bun run build
   ```
4. Use a dedicated AWS sandbox account for any live testing — never production.

## How to contribute

### Bugs

Open a [GitHub issue](https://github.com/CodySwannGT/aws-soc2-setup/issues) with:

- Clear title and reproduction steps
- CLI version (`aws-soc2-setup --version`), Node version, region, and profile type (SSO vs keys)
- Expected vs actual behavior
- Relevant command output (redact account IDs / ARNs if needed)

### Enhancements

Same issue tracker. Explain the use case, which command domain it touches (`sso`, `controltower`, `security`, etc.), and any SOC 2 / security implications.

### Pull requests

- Target `main`
- Follow Conventional Commits
- Include or update Vitest coverage for behavior changes
- Update README / wiki when user-facing behavior changes
- Do not commit secrets, credentials, or live account identifiers

## Development workflow

```bash
bun install
bun run build
bun run test
bun run lint
bun run typecheck
```

Branch names: `feature/…`, `fix/…`, `docs/…`, `refactor/…`, `test/…`.

### Commit messages

[Conventional Commits](https://www.conventionalcommits.org/):

```
feat(status): report Identity Center and OU readiness

Closes #123
```

Types: `feat`, `fix`, `docs`, `style`, `refactor`, `perf`, `test`, `chore`.

## Coding standards

- TypeScript ESM under `src/`; tests under `tests/` mirroring the source tree
- Commander for CLI wiring; domain logic stays out of `src/commands/` when possible
- Shared helpers in `src/lib/` (config, AWS clients, logging, errors)
- Prefer `CliError` for expected user-facing failures
- Honor global `--dry-run` for mutating commands; require `--yes` for destructive `root` ops
- Format/lint with the repo scripts (`bun run format`, `bun run lint`)

## Testing

- Unit tests with Vitest and `aws-sdk-client-mock`
- Prefer injectable runners/gatherers for command handlers (see `setup` and `status`)
- Manual live tests only in disposable sandbox accounts; clean up resources afterward

## Security

- Never hardcode credentials
- Least privilege for any IAM / permission-set examples
- Validate inputs before AWS calls
- Assume changes may be reviewed for SOC 2 / privileged-access impact

## Documentation

- User-facing changes → `README.md` and often `docs/CHECKLIST.md`
- Durable project knowledge → ingest into the [LLM Wiki](wiki/start-here.md) rather than only editing synthesis pages by hand when possible
- Keep examples aligned with the TypeScript CLI (`aws-soc2-setup …`), not the retired Bash scripts

---

Thanks for helping organizations bootstrap secure, compliant AWS environments more safely.
