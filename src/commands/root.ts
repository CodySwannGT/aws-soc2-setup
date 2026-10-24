import type { Command } from "commander";

import {
  requireConfirmation,
  resolveGlobalOptions,
  type GlobalFlags,
} from "../lib/config.js";
import type { GlobalOptions } from "../lib/config.js";
import { info, success, warn } from "../lib/logger.js";
import { runAction } from "../lib/run.js";
import { deleteAccessKey, listRootAccessKeyIds } from "../root/access-keys.js";
import {
  listMemberAccounts,
  removeRootCredentials,
  type MemberAccount,
  type RootRemovalResult,
} from "../root/root-access.js";
import {
  enableRootManagement,
  type FeatureStatus,
} from "../root/root-features.js";

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
  requireConfirmation(globals, "delete root access keys");
  if (keyIds.length === 0) {
    info("No access keys found for the root user");
    return;
  }
  await deleteKeys(globals, keyIds);
};

const RESTRICT_ROOT_HINT =
  "An SCP (typically Control Tower's AWS-GR_RESTRICT_ROOT_USER guardrail) " +
  "denies even centralized root sessions, so root is already unusable in " +
  "those accounts. To also delete any leftover root credentials, run " +
  "`root remove-access` before enabling that control.";

/**
 * Report one account's removal result.
 * @param result - The removal result, or undefined if assume-root failed.
 * @param account - The member account.
 * @returns True when an SCP explicitly denied the root session.
 */
const reportRemoval = (
  result: RootRemovalResult | undefined,
  account: MemberAccount
): boolean => {
  const where = `${account.name} (${account.id})`;
  if (!result) {
    warn(`Could not assume a root session for ${where}`);
    return false;
  }
  const blocked = result.blockedBy.length > 0;
  if (blocked) {
    info(
      `${where}: root already restricted by SCP ${result.blockedBy.join(", ")}`
    );
  }
  if (result.failures.length > 0) {
    warn(`Partial removal for ${where}: ${result.failures.join("; ")}`);
  }
  if (result.cleared.length > 0) {
    success(
      `Removed root credentials from ${where}: ${result.cleared.join(", ")}`
    );
    return blocked;
  }
  if (result.failures.length === 0 && !blocked) {
    info(`No root credentials present in ${where}`);
  }
  return blocked;
};

const removeFromOne = async (
  globals: GlobalOptions,
  account: MemberAccount
): Promise<boolean> => {
  try {
    return reportRemoval(
      await removeRootCredentials(globals, account.id),
      account
    );
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    warn(
      `Failed to remove root credentials for ${account.name} (${account.id}): ${message}`
    );
    return false;
  }
};

const removeFromAll = async (
  globals: GlobalOptions,
  accounts: MemberAccount[]
): Promise<void> => {
  const blocked = await accounts.reduce<Promise<boolean[]>>(
    async (accPromise, account) => [
      ...(await accPromise),
      await removeFromOne(globals, account),
    ],
    Promise.resolve([])
  );
  if (blocked.some(Boolean)) {
    info(RESTRICT_ROOT_HINT);
  }
};

const reportFeature = (label: string, status: FeatureStatus): void => {
  if (status.enabled) {
    success(`${label}: enabled`);
    return;
  }
  warn(`${label}: not enabled (${status.reason ?? "unknown reason"})`);
};

const prepareAndListMembers = async (
  globals: GlobalOptions
): Promise<MemberAccount[]> => {
  const features = await enableRootManagement(globals);
  reportFeature(
    "Centralized root credentials management",
    features.RootCredentialsManagement
  );
  reportFeature("Organizations root sessions", features.RootSessions);
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
  requireConfirmation(globals, "remove root access org-wide");
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
