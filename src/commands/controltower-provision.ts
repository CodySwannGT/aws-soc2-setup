import type { Command } from "commander";

import type { GlobalOptions } from "../lib/config.js";
import { CliError } from "../lib/errors.js";
import { info, success } from "../lib/logger.js";
import { runAction } from "../lib/run.js";
import { getCallerIdentity, ssoSessionName } from "../lib/sts.js";
import { isValidEmail, requireEmail } from "../lib/validate.js";
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
  first?: string;
  last?: string;
  wait?: boolean;
}

/** The Identity Center user Account Factory grants access to the account. */
interface SsoUser {
  email: string;
  firstName: string;
  lastName: string;
}

const capitalize = (word: string): string =>
  `${word.charAt(0).toUpperCase()}${word.slice(1)}`;

const namesFromEmail = (email: string): [string, string] => {
  const localPart = email.split("@")[0] ?? email;
  const [first = localPart, ...rest] = localPart
    .split(/[._-]+/)
    .filter(Boolean)
    .map(capitalize);
  return [first, rest.join(" ") || first];
};

const callerSsoEmail = async (globals: GlobalOptions): Promise<string> => {
  const identity = await getCallerIdentity(globals);
  const session = ssoSessionName(identity.arn);
  if (!session || !isValidEmail(session)) {
    throw new CliError(
      `Cannot derive an IAM Identity Center user from caller ${identity.arn}. ` +
        "Pass --sso-email <email> for an existing named Identity Center user " +
        "(never the account root email)."
    );
  }
  info(`Granting access to the caller's Identity Center user ${session}`);
  return session;
};

const resolveSsoUser = async (
  globals: GlobalOptions,
  options: ProvisionCommandOptions,
  accountEmail: string
): Promise<SsoUser> => {
  const email = options.ssoEmail
    ? requireEmail(options.ssoEmail, "SSO")
    : await callerSsoEmail(globals);
  if (email.toLowerCase() === accountEmail.toLowerCase()) {
    throw new CliError(
      "The SSO user email must not be the account root email; Account " +
        "Factory would create an Identity Center user tied to the root " +
        "mailbox. Pass --sso-email for a named human user."
    );
  }
  const [derivedFirst, derivedLast] = namesFromEmail(email);
  return {
    email,
    firstName: options.first ?? derivedFirst,
    lastName: options.last ?? derivedLast,
  };
};

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
  ssoUser: SsoUser,
  delay: DelayFn
): Promise<void> => {
  const result = await provisionAccount(globals, {
    accountName: options.name,
    accountEmail,
    ssoEmail: ssoUser.email,
    ssoFirstName: ssoUser.firstName,
    ssoLastName: ssoUser.lastName,
    ouName: options.ou,
  });
  success(`Initiated account provisioning (record ${result.recordId})`);
  if (options.wait) {
    await waitForProvisioning(globals, result.recordId, delay);
  }
};

/**
 * Execute `controltower provision-account`: validate emails, resolve the
 * Identity Center user to grant access (the caller's own SSO user unless
 * `--sso-email` is given; never the account root email), provision a new
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
  const ssoUser = await resolveSsoUser(globals, options, accountEmail);
  if (globals.dryRun) {
    info(
      `[dry-run] Would provision account '${options.name}' in OU ${options.ou} with SSO user ${ssoUser.email}`
    );
    return;
  }
  await runProvision(globals, options, accountEmail, ssoUser, delay);
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
    .option(
      "--sso-email <email>",
      "Identity Center user to grant access (defaults to your own SSO user " +
        "when signed in via IAM Identity Center; required otherwise; must " +
        "not be the account root email)"
    )
    .option(
      "-f, --first <firstName>",
      "SSO user first name if Account Factory must create the user " +
        "(defaults to a name derived from the SSO email)"
    )
    .option(
      "-l, --last <lastName>",
      "SSO user last name if Account Factory must create the user " +
        "(defaults to a name derived from the SSO email)"
    )
    .option("-w, --wait", "Wait for provisioning to complete")
    .action(async (options: ProvisionCommandOptions) => {
      await runAction(async () => {
        await handleProvision(globals(), options);
      });
    });
};
