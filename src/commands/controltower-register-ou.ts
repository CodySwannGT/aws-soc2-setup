import type { Command } from "commander";

import {
  registerOrganizationalUnit,
  waitForBaselineOperation,
} from "../controltower/baselines.js";
import { getOrganizationId } from "../controltower/control-tower.js";
import {
  buildOuArn,
  extractOuId,
  isValidOuId,
} from "../controltower/controls.js";
import type { GlobalOptions } from "../lib/config.js";
import { CliError } from "../lib/errors.js";
import { info, success, warn } from "../lib/logger.js";
import { runAction } from "../lib/run.js";
import { getCallerIdentity } from "../lib/sts.js";

/** Options for `controltower register-ou`. */
export interface RegisterOuOptions {
  ou: string;
  baselineVersion?: string;
  wait?: boolean;
}

const DEFAULT_BASELINE_VERSION = "5.0";

const resolveOuArn = async (
  globals: GlobalOptions,
  ou: string
): Promise<string> => {
  if (!isValidOuId(ou)) {
    throw new CliError(
      "Invalid OU id. Expected ou-xxxx-xxxxxxxx, a path ending in that id, or a full OU ARN."
    );
  }
  if (ou.startsWith("arn:aws:organizations::")) {
    return ou;
  }
  const bareOuId = extractOuId(ou);
  const [{ account }, organizationId] = await Promise.all([
    getCallerIdentity(globals),
    getOrganizationId(globals),
  ]);
  return buildOuArn(account, organizationId, bareOuId);
};

const finishRegistrationWait = async (
  globals: GlobalOptions,
  ouArn: string,
  operationIdentifier: string,
  wait: typeof waitForBaselineOperation
): Promise<void> => {
  const status = await wait(globals, operationIdentifier);
  if (status === "SUCCEEDED") {
    success(`OU registration succeeded for ${ouArn}`);
    return;
  }
  if (status === "FAILED") {
    throw new CliError(`OU registration failed for ${ouArn}`);
  }
  warn(`OU registration finished with status ${status} for ${ouArn}`);
};

/**
 * Execute `controltower register-ou`: enable AWSControlTowerBaseline on an OU
 * (registers it with Control Tower). Idempotent. Honors `--dry-run`.
 * @param globals - Resolved global options.
 * @param options - OU id/ARN, optional baseline version, optional --wait.
 * @param wait - Injectable waiter (defaults to live poller).
 */
export const handleRegisterOu = async (
  globals: GlobalOptions,
  options: RegisterOuOptions,
  wait: typeof waitForBaselineOperation = waitForBaselineOperation
): Promise<void> => {
  const baselineVersion = options.baselineVersion ?? DEFAULT_BASELINE_VERSION;
  const ouArn = await resolveOuArn(globals, options.ou);

  if (globals.dryRun) {
    info(
      `[dry-run] Would register OU ${ouArn} with AWSControlTowerBaseline v${baselineVersion}`
    );
    return;
  }

  const result = await registerOrganizationalUnit(
    globals,
    ouArn,
    baselineVersion
  );

  if (result.alreadyRegistered) {
    info(
      `OU already registered with Control Tower (enabled baseline ${result.enabledBaselineArn})`
    );
    return;
  }

  success(
    `Started OU registration: enabled baseline ${result.enabledBaselineArn}`
  );
  if (result.operationIdentifier) {
    info(`Operation: ${result.operationIdentifier}`);
  }

  if (!options.wait || !result.operationIdentifier) {
    return;
  }

  await finishRegistrationWait(
    globals,
    ouArn,
    result.operationIdentifier,
    wait
  );
};

/**
 * Register `controltower register-ou`.
 * @param controltower - The controltower command group.
 * @param globals - Resolver for global options from the root program.
 */
export const registerRegisterOu = (
  controltower: Command,
  globals: () => GlobalOptions
): void => {
  controltower
    .command("register-ou")
    .description(
      "Register an OU with Control Tower (enable AWSControlTowerBaseline)"
    )
    .requiredOption(
      "-o, --ou <ouId>",
      "OU id (ou-xxxx-xxxxxxxx) or full OU ARN"
    )
    .option(
      "--baseline-version <version>",
      "AWSControlTowerBaseline version (default: 5.0 for landing zone 4.0)",
      DEFAULT_BASELINE_VERSION
    )
    .option("--wait", "Wait for the baseline operation to finish")
    .action(async (options: RegisterOuOptions) => {
      await runAction(async () => {
        await handleRegisterOu(globals(), options);
      });
    });
};
