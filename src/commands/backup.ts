import type { Command } from "commander";

import {
  BACKUP_KEY_ALIAS,
  DEFAULT_VAULT_NAME,
  SOC2_PLAN_NAME,
  buildBackupKeyPolicy,
  isValidAccountId,
} from "../backup/policy.js";
import {
  createBackupSelection,
  ensureBackupPlan,
  ensureBackupVault,
  registerBackupAdministrator,
} from "../backup/service.js";
import { createKey, ensureAlias, extractKeyId } from "../kms/keys.js";
import { resolveGlobalOptions, type GlobalFlags } from "../lib/config.js";
import type { GlobalOptions } from "../lib/config.js";
import { CliError } from "../lib/errors.js";
import { info, success, warn } from "../lib/logger.js";
import { runAction } from "../lib/run.js";
import { getCallerIdentity } from "../lib/sts.js";

/** Options accepted by the `backup` command. */
export interface BackupCommandOptions {
  centralAccount: string;
  adminAccount: string;
  vaultName: string;
  kmsKey?: string;
}

/** Account ids validated as well-formed 12-digit AWS account numbers. */
export interface ValidatedAccounts {
  centralAccount: string;
  adminAccount: string;
}

const requireValidAccounts = (
  options: BackupCommandOptions
): ValidatedAccounts => {
  if (!isValidAccountId(options.centralAccount)) {
    throw new CliError(
      `Invalid central account ID '${options.centralAccount}'. Must be a 12-digit number.`
    );
  }
  if (!isValidAccountId(options.adminAccount)) {
    throw new CliError(
      `Invalid admin account ID '${options.adminAccount}'. Must be a 12-digit number.`
    );
  }
  return {
    centralAccount: options.centralAccount,
    adminAccount: options.adminAccount,
  };
};

const provisionBackupKey = async (
  globals: GlobalOptions,
  accountId: string,
  centralAccount: string
): Promise<string> => {
  const arn = await createKey(globals, {
    description: "AWS Backup encryption key for SOC 2 compliance",
    policy: buildBackupKeyPolicy(accountId, centralAccount),
    multiRegion: true,
  });
  await ensureAlias(globals, BACKUP_KEY_ALIAS, extractKeyId(arn));
  success(`Using KMS key: ${arn}`);
  return arn;
};

const reportDryRun = (
  globals: GlobalOptions,
  options: BackupCommandOptions,
  accounts: ValidatedAccounts,
  accountId: string
): void => {
  info(
    `[dry-run] Would ensure vault '${options.vaultName}', plan '${SOC2_PLAN_NAME}', and a resource selection in account ${accountId} (${globals.region}), and register ${accounts.adminAccount} as delegated admin`
  );
  if (!options.kmsKey) {
    info("[dry-run] Would create a new multi-region KMS backup key");
  }
};

const reportRegistration = (
  registered: boolean,
  adminAccount: string
): void => {
  if (registered) {
    success(`Registered ${adminAccount} as delegated backup administrator`);
    return;
  }
  warn(
    `Could not register delegated administrator (expected unless run from the Organizations management account). From the management account run: aws organizations register-delegated-administrator --service-principal backup.amazonaws.com --account-id ${adminAccount}`
  );
};

const BACKUP_POLICY_PREREQUISITES =
  "Managing AWS Organizations backup policies from the delegated administrator also requires the management account to attach an Organizations resource-based delegation policy that allows that account to manage backup policies, and the administrator's IAM role to have the AWS Backup and Organizations policy permissions.";

const keyAccessStatement = (
  centralAccount: string,
  keyCreated: boolean
): string =>
  keyCreated
    ? `The backup KMS key created by this command grants ${centralAccount} use of the key.`
    : `You supplied --kms-key, so ${centralAccount} was not granted use of it; configure that key's policy separately.`;

const reportScope = (
  globals: GlobalOptions,
  accounts: ValidatedAccounts,
  accountId: string,
  keyCreated: boolean
): void => {
  info(
    `The vault, plan, and selection were created in account ${accountId} (${globals.region}), the account you ran this from, and protect resources in that account only.`
  );
  info(
    `Workload accounts need their own plans: run \`backup\` in each workload account, or manage AWS Organizations backup policies from the delegated administrator ${accounts.adminAccount}. ${BACKUP_POLICY_PREREQUISITES}`
  );
  info(
    `${keyAccessStatement(accounts.centralAccount, keyCreated)} No cross-account copy is configured.`
  );
};

const applyBackupConfiguration = async (
  globals: GlobalOptions,
  options: BackupCommandOptions,
  accounts: ValidatedAccounts,
  accountId: string
): Promise<void> => {
  const kmsKeyArn =
    options.kmsKey ??
    (await provisionBackupKey(globals, accountId, accounts.centralAccount));
  const vaultArn = await ensureBackupVault(
    globals,
    options.vaultName,
    kmsKeyArn
  );
  const planId = await ensureBackupPlan(globals, options.vaultName);
  const selectionId = await createBackupSelection(globals, planId, accountId);
  const registered = await registerBackupAdministrator(
    globals,
    accounts.adminAccount
  );
  success(`Backup vault ready: ${vaultArn}`);
  success(`Backup plan ready: ${planId}`);
  success(`Resource selection created: ${selectionId}`);
  reportRegistration(registered, accounts.adminAccount);
  reportScope(globals, accounts, accountId, options.kmsKey === undefined);
};

/**
 * Execute the `backup` command: validate accounts, ensure an encryption key
 * (usable by the central account), vault, plan, and resource selection in the
 * CALLER's account, then register the admin account as the delegated backup
 * administrator. Honors `--dry-run` by reporting intended actions.
 * @param globals - Resolved global options (region, profile, dryRun).
 * @param options - The parsed `backup` command options.
 */
export const handleBackup = async (
  globals: GlobalOptions,
  options: BackupCommandOptions
): Promise<void> => {
  const accounts = requireValidAccounts(options);
  const identity = await getCallerIdentity(globals);
  if (globals.dryRun) {
    reportDryRun(globals, options, accounts, identity.account);
    return;
  }
  await applyBackupConfiguration(globals, options, accounts, identity.account);
};

/**
 * Register the `backup` command on the given program.
 * @param program - The root commander program to attach the command to.
 */
export const registerBackup = (program: Command): void => {
  program
    .command("backup")
    .description(
      "Configure AWS Backup (vault, plan, selection) in the caller's account and register a delegated admin"
    )
    .requiredOption(
      "-c, --central-account <id>",
      "Central backup account ID granted use of the backup KMS key this command creates; not applied to a --kms-key you supply (12 digits)"
    )
    .requiredOption(
      "-a, --admin-account <id>",
      "Account to register as the delegated AWS Backup administrator (12 digits)"
    )
    .option("-v, --vault-name <name>", "Backup vault name", DEFAULT_VAULT_NAME)
    .option(
      "-k, --kms-key <arn>",
      "KMS key ARN for backups (a new key is created if omitted)"
    )
    .action(async (options: BackupCommandOptions) => {
      await runAction(async () => {
        await handleBackup(
          resolveGlobalOptions(program.opts<GlobalFlags>()),
          options
        );
      });
    });
};
