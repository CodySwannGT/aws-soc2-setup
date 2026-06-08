import { createRequire } from "module";

import { Command } from "commander";

import { registerBackup } from "./commands/backup.js";
import { registerControlTower } from "./commands/controltower.js";
import { registerKms } from "./commands/kms.js";
import { registerRoot } from "./commands/root.js";
import { registerSecurity } from "./commands/security.js";
import { registerSetup } from "./commands/setup.js";
import { registerSso } from "./commands/sso.js";
import { registerStatus } from "./commands/status.js";
import { registerWhoami } from "./commands/whoami.js";

const require = createRequire(import.meta.url);

const DESCRIPTION =
  "Automated AWS Control Tower setup for SOC 2 compliance — account provisioning, IAM Identity Center, security services, backup, and KMS";

/**
 * Read the package version from package.json at runtime so the CLI reports the
 * same version that was published.
 * @returns The current package version string.
 */
export const getVersion = (): string => {
  const pkg = require("../package.json") as { version: string };
  return pkg.version;
};

/**
 * Build the configured root commander program. Kept separate from the process
 * entrypoint (src/cli.ts) so the wiring can be unit-tested without invoking
 * real `process.argv` parsing. Each domain registers its own commands.
 * @returns A fully configured commander `Command` instance.
 */
export const buildProgram = (): Command => {
  const program = new Command();

  program
    .name("aws-soc2-setup")
    .description(DESCRIPTION)
    .version(getVersion())
    .option("-p, --profile <profile>", "AWS CLI profile to use")
    .option(
      "-r, --region <region>",
      "AWS region (defaults to AWS_REGION or us-east-1)"
    )
    .option("--dry-run", "Preview actions without making any changes")
    .option("-y, --yes", "Skip confirmation prompts");

  registerStatus(program);
  registerWhoami(program);
  registerKms(program);
  registerBackup(program);
  registerSso(program);
  registerSecurity(program);
  registerControlTower(program);
  registerRoot(program);
  registerSetup(program);

  return program;
};
