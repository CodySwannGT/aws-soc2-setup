import type { Command } from "commander";

import { resolveGlobalOptions, type GlobalFlags } from "../lib/config.js";
import type { GlobalOptions } from "../lib/config.js";
import { CliError } from "../lib/errors.js";
import { info, success, warn } from "../lib/logger.js";
import { runAction } from "../lib/run.js";
import { deleteAccessKey, listRootAccessKeyIds } from "../root/access-keys.js";
import {
  enableRootManagement,
  listMemberAccounts,
  removeRootCredentials,
  type MemberAccount,
  type RootRemovalResult,
} from "../root/root-access.js";

const requireYes = (globals: GlobalOptions, action: string): void => {
  if (!globals.yes) {
    throw new CliError(
      `Refusing to ${action} without confirmation. Re-run with --yes to proceed.`
    );
  }
};

const deleteKeys = async (
  globals: GlobalOptions,
  keyIds: string[]
): Promise<void> => {
  for (const keyId of keyIds) {
    await deleteAccessKey(globals, keyId);
    success(`Deleted root access key ${keyId}`);
  }
};

/**
 * Execute `root delete-keys`: delete all root user access keys. Requires
 * `--yes`; `--dry-run` lists keys without deleting.
 * @param globals - Resolved global options.
 */
export const handleDeleteKeys = async (
  globals: GlobalOptions
): Promise<void> => {
  const keyIds = await listRootAccessKeyIds(globals);
  if (globals.dryRun) {
    info(`[dry-run] Would delete ${keyIds.length} root access key(s)`);
    return;
  }
  requireYes(globals, "delete root access keys");
  if (keyIds.length === 0) {
    info("No access keys found for the root user");
    return;
  }
  await deleteKeys(globals, keyIds);
};

const reportRemoval = (
  result: RootRemovalResult | undefined,
  account: MemberAccount
): void => {
  const where = `${account.name} (${account.id})`;
  if (!result) {
    warn(`Could not assume a root session for ${where}`);
    return;
  }
  if (result.failures.length > 0) {
    warn(`Partial removal for ${where}: ${result.failures.join("; ")}`);
  }
  if (result.cleared.length > 0) {
    success(
      `Removed root credentials from ${where}: ${result.cleared.join(", ")}`
    );
    return;
  }
  if (result.failures.length === 0) {
    info(`No root credentials present in ${where}`);
  }
};

const removeFromAll = async (
  globals: GlobalOptions,
  accounts: MemberAccount[]
): Promise<void> => {
  for (const account of accounts) {
    reportRemoval(await removeRootCredentials(globals, account.id), account);
  }
};

const prepareAndListMembers = async (
  globals: GlobalOptions
): Promise<MemberAccount[]> => {
  await enableRootManagement(globals);
  return listMemberAccounts(globals);
};

const runRemoveAccess = async (globals: GlobalOptions): Promise<void> => {
  const accounts = await prepareAndListMembers(globals);
  if (accounts.length === 0) {
    info("No member accounts found");
    return;
  }
  await removeFromAll(globals, accounts);
};

/**
 * Execute `root remove-access`: enable org root management and remove root
 * credentials from member accounts. Requires `--yes`; `--dry-run` previews.
 * @param globals - Resolved global options.
 */
export const handleRemoveAccess = async (
  globals: GlobalOptions
): Promise<void> => {
  if (globals.dryRun) {
    info("[dry-run] Would remove root credentials from all member accounts");
    return;
  }
  requireYes(globals, "remove root access org-wide");
  await runRemoveAccess(globals);
};

/**
 * Register the `root` command group (delete-keys, remove-access).
 * @param program - The root commander program to attach the commands to.
 */
export const registerRoot = (program: Command): void => {
  const globals = (): GlobalOptions =>
    resolveGlobalOptions(program.opts<GlobalFlags>());
  const root = program
    .command("root")
    .description("Harden the AWS root user (destructive — requires --yes)");

  root
    .command("delete-keys")
    .description("Delete all root user access keys")
    .action(async () => {
      await runAction(async () => {
        await handleDeleteKeys(globals());
      });
    });

  root
    .command("remove-access")
    .description("Remove root credentials across organization member accounts")
    .action(async () => {
      await runAction(async () => {
        await handleRemoveAccess(globals());
      });
    });
};
