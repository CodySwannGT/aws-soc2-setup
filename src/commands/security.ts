import type { Command } from "commander";

import { resolveGlobalOptions, type GlobalFlags } from "../lib/config.js";
import type { GlobalOptions } from "../lib/config.js";
import { CliError } from "../lib/errors.js";
import { info, warn } from "../lib/logger.js";
import { runAction } from "../lib/run.js";
import { getCallerIdentity } from "../lib/sts.js";
import { enableAwsConfig } from "../security/config.js";
import {
  enableGuardDuty,
  enableInspector,
  enableMacie,
  enableSecurityHub,
} from "../security/detectors.js";

import { registerSecurityAudit } from "./security-audit.js";
import { registerConformancePacks } from "./security-conformance-packs.js";

/** Options for `security enable`. */
export interface SecurityEnableOptions {
  guardduty?: boolean;
  securityHub?: boolean;
  config?: boolean;
  macie?: boolean;
  inspector?: boolean;
  all?: boolean;
}

/** Resolved set of security services to enable. */
interface Selection {
  config: boolean;
  guardduty: boolean;
  securityHub: boolean;
  macie: boolean;
  inspector: boolean;
}

const requireSelection = (options: SecurityEnableOptions): Selection => {
  const all = options.all ?? false;
  const selection: Selection = {
    config: all || (options.config ?? false),
    guardduty: all || (options.guardduty ?? false),
    securityHub: all || (options.securityHub ?? false),
    macie: all || (options.macie ?? false),
    inspector: all || (options.inspector ?? false),
  };
  if (!Object.values(selection).some(Boolean)) {
    throw new CliError(
      "No security services selected. Use --all or pick services (-g/-s/-c/-m/-i)."
    );
  }
  return selection;
};

const isolate = async (
  label: string,
  op: () => Promise<void>
): Promise<void> => {
  try {
    await op();
  } catch (caught) {
    warn(
      `${label} failed: ${caught instanceof Error ? caught.message : String(caught)}`
    );
  }
};

const runSelected = async (
  globals: GlobalOptions,
  selection: Selection,
  accountId: string
): Promise<void> => {
  // Each service is isolated: a failure in one warns and continues to the
  // rest, matching the original script's independent per-service blocks.
  // (helper defined above)
  if (selection.config) {
    await isolate("AWS Config", () => enableAwsConfig(globals, accountId));
  }
  if (selection.guardduty) {
    await isolate("GuardDuty", () => enableGuardDuty(globals));
  }
  if (selection.securityHub) {
    await isolate("Security Hub", () => enableSecurityHub(globals));
  }
  if (selection.macie) {
    await isolate("Macie", () => enableMacie(globals));
  }
  if (selection.inspector) {
    await isolate("Inspector", () => enableInspector(globals));
  }
};

const applySecurityServices = async (
  globals: GlobalOptions,
  selection: Selection
): Promise<void> => {
  const identity = await getCallerIdentity(globals);
  await runSelected(globals, selection, identity.account);
};

const reportDryRun = (selection: Selection): void => {
  const services = Object.entries(selection)
    .filter(([, on]) => on)
    .map(([name]) => name);
  info(`[dry-run] Would enable: ${services.join(", ")}`);
};

/**
 * Execute `security enable`: turn on the selected AWS security services. Honors
 * `--dry-run`.
 * @param globals - Resolved global options.
 * @param options - The parsed enable options.
 */
export const handleSecurityEnable = async (
  globals: GlobalOptions,
  options: SecurityEnableOptions
): Promise<void> => {
  const selection = requireSelection(options);
  if (globals.dryRun) {
    reportDryRun(selection);
    return;
  }
  await applySecurityServices(globals, selection);
};

/**
 * Register the `security` command group (enable, audit, conformance-packs).
 * @param program - The root commander program to attach the commands to.
 */
export const registerSecurity = (program: Command): void => {
  const globals = (): GlobalOptions =>
    resolveGlobalOptions(program.opts<GlobalFlags>());
  const security = program
    .command("security")
    .description("Enable AWS security services and audit reporting for SOC 2");

  security
    .command("enable")
    .description(
      "Enable AWS security services (GuardDuty, Security Hub, Config, Macie, Inspector)"
    )
    .option("-g, --guardduty", "Enable Amazon GuardDuty")
    .option("-s, --security-hub", "Enable AWS Security Hub")
    .option("-c, --config", "Enable AWS Config")
    .option("-m, --macie", "Enable Amazon Macie")
    .option("-i, --inspector", "Enable Amazon Inspector")
    .option("-a, --all", "Enable all security services")
    .action(async (options: SecurityEnableOptions) => {
      await runAction(async () => {
        await handleSecurityEnable(globals(), options);
      });
    });

  registerSecurityAudit(security, globals);
  registerConformancePacks(security, globals);
};
