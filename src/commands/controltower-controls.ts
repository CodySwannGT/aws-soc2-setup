import type { Command } from "commander";

import type { GlobalOptions } from "../lib/config.js";
import { CliError } from "../lib/errors.js";
import { info, success, warn } from "../lib/logger.js";
import { runAction } from "../lib/run.js";
import { getCallerIdentity } from "../lib/sts.js";
import type {
  ControlBaseline,
  Soc2Type,
} from "../controltower/control-catalog.js";
import {
  enableControlWithFormats,
  enableSecurityHubFallback,
  getOrganizationId,
} from "../controltower/control-tower.js";
import {
  buildOuArn,
  controlIdentifierFormats,
  describeControl,
  extractOuId,
  isValidOuId,
  selectControls,
} from "../controltower/controls.js";

/** Options for `controltower enable-controls`. */
export interface EnableControlsOptions {
  ou: string;
  soc2Type: string;
  baseline: string;
  alternative?: boolean;
}

/** Tally of control-enable outcomes. */
interface EnableSummary {
  success: number;
  failure: number;
}

const SOC2_TYPES = ["type1", "type2", "both"];
const BASELINES = ["minimal", "recommended", "comprehensive"];

const requireSoc2Type = (value: string): Soc2Type => {
  if (!SOC2_TYPES.includes(value)) {
    throw new CliError("Invalid SOC 2 type. Must be type1, type2, or both.");
  }
  return value as Soc2Type;
};

const requireBaseline = (value: string): ControlBaseline => {
  if (!BASELINES.includes(value)) {
    throw new CliError(
      "Invalid baseline. Must be minimal, recommended, or comprehensive."
    );
  }
  return value as ControlBaseline;
};

const reportControl = (ok: boolean, controlId: string): void => {
  const description = describeControl(controlId);
  if (ok) {
    success(`Enabled ${description} (${controlId})`);
    return;
  }
  warn(`Failed to enable ${description} (${controlId})`);
};

const enableOne = async (
  globals: GlobalOptions,
  controlId: string,
  targetArn: string
): Promise<boolean> => {
  const formats = controlIdentifierFormats(controlId, globals.region);
  const ok = await enableControlWithFormats(globals, formats, targetArn);
  reportControl(ok, controlId);
  return ok;
};

const enableAll = async (
  globals: GlobalOptions,
  controls: string[],
  targetArn: string
): Promise<EnableSummary> => {
  const outcomes = await controls.reduce<Promise<boolean[]>>(
    async (accPromise, controlId) => {
      const acc = await accPromise;
      return [...acc, await enableOne(globals, controlId, targetArn)];
    },
    Promise.resolve([])
  );
  const successes = outcomes.filter(Boolean).length;
  return { success: successes, failure: outcomes.length - successes };
};

const maybeFallback = async (
  globals: GlobalOptions,
  options: EnableControlsOptions,
  results: EnableSummary
): Promise<void> => {
  if (!options.alternative || results.success > 0 || results.failure === 0) {
    return;
  }
  info("All controls failed; attempting AWS Security Hub fallback...");
  if (await enableSecurityHubFallback(globals)) {
    success(
      "Enabled Security Hub with a foundational standard as an alternative"
    );
    return;
  }
  warn("Could not enable the Security Hub alternative");
};

const runControls = async (
  globals: GlobalOptions,
  options: EnableControlsOptions,
  controls: string[]
): Promise<void> => {
  const identity = await getCallerIdentity(globals);
  const orgId = await getOrganizationId(globals);
  const targetArn = buildOuArn(
    identity.account,
    orgId,
    extractOuId(options.ou)
  );
  const results = await enableAll(globals, controls, targetArn);
  info(`Enabled ${results.success} control(s), ${results.failure} failed`);
  await maybeFallback(globals, options, results);
};

/**
 * Execute `controltower enable-controls`: select SOC 2 controls by type and
 * baseline and enable each on the target OU, with an optional Security Hub
 * fallback. Honors `--dry-run`.
 * @param globals - Resolved global options.
 * @param options - The parsed enable-controls options.
 */
export const handleEnableControls = async (
  globals: GlobalOptions,
  options: EnableControlsOptions
): Promise<void> => {
  const soc2Type = requireSoc2Type(options.soc2Type);
  const baseline = requireBaseline(options.baseline);
  const controls = selectControls(soc2Type, baseline);
  if (!isValidOuId(options.ou)) {
    warn(`OU id '${options.ou}' looks malformed; attempting anyway`);
  }
  if (globals.dryRun) {
    info(
      `[dry-run] Would enable ${controls.length} controls: ${controls.join(", ")}`
    );
    return;
  }
  await runControls(globals, options, controls);
};

/**
 * Register the `controltower enable-controls` subcommand.
 * @param controltower - The `controltower` parent command.
 * @param globals - Resolver for global options from the root program.
 */
export const registerEnableControls = (
  controltower: Command,
  globals: () => GlobalOptions
): void => {
  controltower
    .command("enable-controls")
    .description(
      "Enable SOC 2 Control Tower controls on an organizational unit"
    )
    .requiredOption("-o, --ou <ouId>", "Target OU id, path, or ARN")
    .option(
      "-s, --soc2-type <type>",
      "SOC 2 type: type1, type2, or both",
      "both"
    )
    .option(
      "-b, --baseline <level>",
      "Baseline: minimal, recommended, or comprehensive",
      "recommended"
    )
    .option("-a, --alternative", "Fall back to Security Hub if controls fail")
    .action(async (options: EnableControlsOptions) => {
      await runAction(async () => {
        await handleEnableControls(globals(), options);
      });
    });
};
