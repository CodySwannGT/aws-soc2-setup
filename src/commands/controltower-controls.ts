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
  enableSecurityHubFallback,
  enableSoc2Control,
  getOrganizationId,
  type ControlOutcome,
} from "../controltower/control-tower.js";
import {
  buildOuArn,
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
type EnableSummary = Record<ControlOutcome["status"], number>;

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

const reportControl = (outcome: ControlOutcome, controlId: string): void => {
  const label = `${describeControl(controlId)} (${controlId})`;
  if (outcome.status === "enabled") {
    success(`Enabled ${label}`);
    return;
  }
  if (outcome.status === "enforced") {
    success(`${label} is already enforced by the landing zone`);
    return;
  }
  if (outcome.status === "not-found") {
    warn(
      `${label} was not found in the AWS Control Catalog: ${outcome.reason}`
    );
    return;
  }
  warn(`Failed to enable ${label}: ${outcome.reason}`);
};

const enableOne = async (
  globals: GlobalOptions,
  controlId: string,
  targetArn: string
): Promise<ControlOutcome> => {
  const outcome = await enableSoc2Control(globals, controlId, targetArn);
  reportControl(outcome, controlId);
  return outcome;
};

const tally = (outcomes: ControlOutcome[]): EnableSummary =>
  outcomes.reduce<EnableSummary>(
    (summary, outcome) => ({
      ...summary,
      [outcome.status]: summary[outcome.status] + 1,
    }),
    { enabled: 0, enforced: 0, "not-found": 0, failed: 0 }
  );

const enableAll = async (
  globals: GlobalOptions,
  controls: string[],
  targetArn: string
): Promise<EnableSummary> => {
  const outcomes = await controls.reduce<Promise<ControlOutcome[]>>(
    async (accPromise, controlId) => {
      const acc = await accPromise;
      return [...acc, await enableOne(globals, controlId, targetArn)];
    },
    Promise.resolve([])
  );
  return tally(outcomes);
};

const summarize = (results: EnableSummary): string =>
  [
    `Enabled ${results.enabled} control(s)`,
    `${results.enforced} already enforced by the landing zone`,
    `${results["not-found"]} not found in the Control Catalog`,
    `${results.failed} failed`,
  ].join(", ");

const maybeFallback = async (
  globals: GlobalOptions,
  options: EnableControlsOptions,
  results: EnableSummary
): Promise<void> => {
  const succeeded = results.enabled + results.enforced;
  const unsuccessful = results["not-found"] + results.failed;
  if (!options.alternative || succeeded > 0 || unsuccessful === 0) {
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
  info(summarize(results));
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
    .option(
      "-a, --alternative",
      "Fall back to Security Hub if no control could be enabled"
    )
    .action(async (options: EnableControlsOptions) => {
      await runAction(async () => {
        await handleEnableControls(globals(), options);
      });
    });
};
