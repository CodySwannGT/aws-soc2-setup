import type { Command } from "commander";

import { resolveGlobalOptions, type GlobalFlags } from "../lib/config.js";
import type { GlobalOptions } from "../lib/config.js";
import { info, success, warn } from "../lib/logger.js";
import { runAction } from "../lib/run.js";
import { SETUP_PLAN } from "../orchestrator/plan.js";
import {
  gatherEnvironmentStatus,
  type CheckState,
  type EnvironmentStatus,
  type StatusCheck,
} from "../status/environment.js";

const STATE_LABEL: Record<CheckState, string> = {
  ok: "ok",
  missing: "missing",
  unknown: "unknown",
};

const writeCheck = (check: StatusCheck): void => {
  const line = `${check.label}: ${STATE_LABEL[check.state]} — ${check.detail}`;
  if (check.state === "ok") {
    success(line);
    return;
  }
  if (check.state === "missing") {
    warn(line);
    return;
  }
  info(line);
};

const writeHeader = (status: EnvironmentStatus): void => {
  info("aws-soc2-setup environment status");
  info(`Region:  ${status.region}`);
  info(`Profile: ${status.profile ?? "(default credential chain)"}`);
  info(
    `Setup plan: ${status.planSummary.total} steps (${status.planSummary.automated} automated, ${status.planSummary.manual} manual)`
  );
};

const writeNextSteps = (status: EnvironmentStatus): void => {
  const missing = status.checks.filter(check => check.state === "missing");
  const firstManual = SETUP_PLAN.find(step => step.kind === "manual");
  if (missing.length === 0) {
    info("Next: run `aws-soc2-setup setup --dry-run` to review the full plan.");
    return;
  }
  info("Suggested next steps:");
  for (const check of missing) {
    if (check.id === "identity") {
      info("  - Configure credentials, then retry (`aws-soc2-setup whoami`).");
    } else if (check.id === "organization") {
      info("  - Enable AWS Organizations / Control Tower in the console.");
    } else if (check.id === "ous") {
      info("  - Create OUs: `aws-soc2-setup controltower create-ous --all`.");
    } else if (check.id === "identity-center") {
      info("  - Enable IAM Identity Center in the AWS console.");
    }
  }
  if (firstManual) {
    info(
      `  - Full guided plan: \`aws-soc2-setup setup --dry-run\` (starts with step ${firstManual.number}).`
    );
  }
};

/**
 * Print a read-only snapshot of the caller's AWS environment against the SOC 2
 * setup expectations. Never mutates AWS resources; `--dry-run` is a no-op here
 * because the command is already non-mutating.
 * @param globals - Resolved global options.
 * @param gather - Injectable probe (defaults to the live AWS gatherer).
 */
export const handleStatus = async (
  globals: GlobalOptions,
  gather: typeof gatherEnvironmentStatus = gatherEnvironmentStatus
): Promise<void> => {
  const status = await gather(globals);
  writeHeader(status);
  for (const check of status.checks) {
    writeCheck(check);
  }
  writeNextSteps(status);
};

/**
 * Register the `status` command on the given program.
 * @param program - The root commander program to attach the command to.
 */
export const registerStatus = (program: Command): void => {
  program
    .command("status")
    .description(
      "Show AWS environment readiness for the SOC 2 Control Tower setup"
    )
    .action(async () => {
      await runAction(async () => {
        await handleStatus(resolveGlobalOptions(program.opts<GlobalFlags>()));
      });
    });
};
