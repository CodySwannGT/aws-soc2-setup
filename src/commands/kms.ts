import type { Command } from "commander";

import { resolveGlobalOptions, type GlobalFlags } from "../lib/config.js";
import type { GlobalOptions } from "../lib/config.js";
import { info, success } from "../lib/logger.js";
import { runAction } from "../lib/run.js";
import {
  describeKey,
  getKeyPolicy,
  getKeyRotationStatus,
  putKeyPolicy,
  setKeyRotation,
} from "../kms/keys.js";
import {
  addAdministratorToPolicy,
  removeAdministratorFromPolicy,
  type KeyPolicy,
} from "../kms/policy.js";

/** Options accepted by the `kms` command. */
export interface KmsCommandOptions {
  keyId: string;
  addAdmin?: string;
  removeAdmin?: string;
  showPolicy?: boolean;
  enableRotation?: boolean;
  disableRotation?: boolean;
}

const applyPolicyChange = async (
  globals: GlobalOptions,
  keyId: string,
  transform: (policy: KeyPolicy) => KeyPolicy,
  describeChange: string
): Promise<void> => {
  const current = await getKeyPolicy(globals, keyId);
  const next = transform(current);
  if (next === current) {
    info(`No policy change needed (${describeChange})`);
    return;
  }
  if (globals.dryRun) {
    info(`[dry-run] Would update key policy: ${describeChange}`);
    return;
  }
  await putKeyPolicy(globals, keyId, next);
  success(describeChange);
};

const applyRotation = async (
  globals: GlobalOptions,
  keyId: string,
  enabled: boolean
): Promise<void> => {
  const verb = enabled ? "enable" : "disable";
  if (globals.dryRun) {
    info(`[dry-run] Would ${verb} automatic key rotation`);
    return;
  }
  await setKeyRotation(globals, keyId, enabled);
  success(`${enabled ? "Enabled" : "Disabled"} automatic key rotation`);
};

/**
 * Execute the `kms` command against a key: report its identity, optionally show
 * the policy, add/remove an administrator, toggle rotation, and always print the
 * current rotation status. Honors `--dry-run`.
 * @param globals - Resolved global options (region, profile, dryRun).
 * @param options - The parsed `kms` command options.
 */
export const handleKms = async (
  globals: GlobalOptions,
  options: KmsCommandOptions
): Promise<void> => {
  const { keyId } = options;
  const key = await describeKey(globals, keyId);
  info(`Key ARN:   ${key.arn}`);
  info(`Key state: ${key.state}`);

  if (options.showPolicy) {
    info(JSON.stringify(await getKeyPolicy(globals, keyId), null, 2));
  }
  if (options.addAdmin) {
    const admin = options.addAdmin;
    await applyPolicyChange(
      globals,
      keyId,
      policy => addAdministratorToPolicy(policy, admin),
      `Added administrator ${admin}`
    );
  }
  if (options.removeAdmin) {
    const admin = options.removeAdmin;
    await applyPolicyChange(
      globals,
      keyId,
      policy => removeAdministratorFromPolicy(policy, admin),
      `Removed administrator ${admin}`
    );
  }
  if (options.enableRotation) {
    await applyRotation(globals, keyId, true);
  }
  if (options.disableRotation) {
    await applyRotation(globals, keyId, false);
  }

  info(
    `Key rotation: ${(await getKeyRotationStatus(globals, keyId)) ? "enabled" : "disabled"}`
  );
};

/**
 * Register the `kms` command on the given program.
 * @param program - The root commander program to attach the command to.
 */
export const registerKms = (program: Command): void => {
  program
    .command("kms")
    .description("Manage a KMS key's administrators and automatic rotation")
    .requiredOption("-k, --key-id <keyId>", "KMS key id or ARN to manage")
    .option(
      "-a, --add-admin <arn>",
      "ARN of an IAM user/role to add as administrator"
    )
    .option(
      "--remove-admin <arn>",
      "ARN of an IAM user/role to remove as administrator"
    )
    .option("-s, --show-policy", "Print the current key policy")
    .option("-e, --enable-rotation", "Enable automatic key rotation")
    .option("--disable-rotation", "Disable automatic key rotation")
    .action(async (options: KmsCommandOptions) => {
      await runAction(async () => {
        await handleKms(
          resolveGlobalOptions(program.opts<GlobalFlags>()),
          options
        );
      });
    });
};
