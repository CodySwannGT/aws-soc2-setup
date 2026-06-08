import type { Command } from "commander";

import type { GlobalOptions } from "../lib/config.js";
import { CliError } from "../lib/errors.js";
import { info, success } from "../lib/logger.js";
import { runAction } from "../lib/run.js";
import { requireEmail } from "../lib/validate.js";
import {
  getProvisionedAccountId,
  getRecordStatus,
  provisionAccount,
} from "../controltower/account-factory.js";

/** A delay function (ms → Promise); injectable so tests can run instantly. */
export type DelayFn = (ms: number) => Promise<void>;

const realDelay: DelayFn = ms =>
  new Promise(resolve => {
    setTimeout(resolve, ms);
  });

/** Options for `controltower provision-account`. */
export interface ProvisionCommandOptions {
  name: string;
  email: string;
  ou: string;
  ssoEmail?: string;
  first: string;
  last: string;
  wait?: boolean;
}

const pollStatus = async (
  globals: GlobalOptions,
  recordId: string,
  delay: DelayFn
): Promise<void> => {
  const status = await getRecordStatus(globals, recordId);
  info(`Provisioning status: ${status ?? "unknown"}`);
  if (status === "SUCCEEDED") {
    success("Account provisioning completed");
    return;
  }
  if (status === "FAILED" || status === "CANCELED") {
    throw new CliError(`Account provisioning ${status}`);
  }
  await delay(60_000);
  await pollStatus(globals, recordId, delay);
};

const reportProvisionedAccount = async (
  globals: GlobalOptions,
  recordId: string
): Promise<void> => {
  const accountId = await getProvisionedAccountId(globals, recordId);
  if (accountId) {
    info(`New account ID: ${accountId}`);
  }
};

const waitForProvisioning = async (
  globals: GlobalOptions,
  recordId: string,
  delay: DelayFn
): Promise<void> => {
  await delay(30_000);
  await pollStatus(globals, recordId, delay);
  await reportProvisionedAccount(globals, recordId);
};

const runProvision = async (
  globals: GlobalOptions,
  options: ProvisionCommandOptions,
  accountEmail: string,
  ssoEmail: string,
  delay: DelayFn
): Promise<void> => {
  const result = await provisionAccount(globals, {
    accountName: options.name,
    accountEmail,
    ssoEmail,
    ssoFirstName: options.first,
    ssoLastName: options.last,
    ouName: options.ou,
  });
  success(`Initiated account provisioning (record ${result.recordId})`);
  if (options.wait) {
    await waitForProvisioning(globals, result.recordId, delay);
  }
};

/**
 * Execute `controltower provision-account`: validate emails, provision a new
 * account through Account Factory, and optionally wait for completion. Honors
 * `--dry-run`.
 * @param globals - Resolved global options.
 * @param options - The parsed provision options.
 * @param delay - Delay implementation (injectable for tests).
 */
export const handleProvision = async (
  globals: GlobalOptions,
  options: ProvisionCommandOptions,
  delay: DelayFn = realDelay
): Promise<void> => {
  const accountEmail = requireEmail(options.email, "account");
  const ssoEmail = requireEmail(options.ssoEmail ?? options.email, "SSO");
  if (globals.dryRun) {
    info(
      `[dry-run] Would provision account '${options.name}' in OU ${options.ou}`
    );
    return;
  }
  await runProvision(globals, options, accountEmail, ssoEmail, delay);
};

/**
 * Register the `controltower provision-account` subcommand.
 * @param controltower - The `controltower` parent command.
 * @param globals - Resolver for global options from the root program.
 */
export const registerProvision = (
  controltower: Command,
  globals: () => GlobalOptions
): void => {
  controltower
    .command("provision-account")
    .description(
      "Provision a new account through Control Tower Account Factory"
    )
    .requiredOption("-n, --name <name>", "Account name")
    .requiredOption(
      "-e, --email <email>",
      "Root user email for the new account"
    )
    .requiredOption(
      "-o, --ou <name>",
      "Organizational unit to place the account in"
    )
    .option("--sso-email <email>", "SSO user email (defaults to account email)")
    .option("-f, --first <firstName>", "SSO user first name", "Admin")
    .option("-l, --last <lastName>", "SSO user last name", "User")
    .option("-w, --wait", "Wait for provisioning to complete")
    .action(async (options: ProvisionCommandOptions) => {
      await runAction(async () => {
        await handleProvision(globals(), options);
      });
    });
};
