import type { Command } from "commander";

import { resolveGlobalOptions, type GlobalFlags } from "../lib/config.js";
import type { GlobalOptions } from "../lib/config.js";
import { CliError } from "../lib/errors.js";
import { info, success } from "../lib/logger.js";
import { runAction } from "../lib/run.js";
import {
  ensureOu,
  getRootId,
  type EnsuredOu,
} from "../controltower/organizations.js";

import { registerEnableControls } from "./controltower-controls.js";
import { registerProvision } from "./controltower-provision.js";

/** Options for `controltower create-ous`. */
export interface CreateOusOptions {
  infrastructure?: boolean;
  workloads?: boolean;
  sandbox?: boolean;
  all?: boolean;
}

/**
 *
 */
interface OuSelection {
  infrastructure: boolean;
  workloads: boolean;
  sandbox: boolean;
}

const requireOuSelection = (options: CreateOusOptions): OuSelection => {
  const all = options.all ?? false;
  const selection: OuSelection = {
    infrastructure: all || (options.infrastructure ?? false),
    workloads: all || (options.workloads ?? false),
    sandbox: all || (options.sandbox ?? false),
  };
  if (!Object.values(selection).some(Boolean)) {
    throw new CliError("No OUs selected. Use --all or pick OUs (-i/-w/-s).");
  }
  return selection;
};

const reportOu = (result: EnsuredOu, name: string): void => {
  if (result.created) {
    success(`Created OU '${name}' with ID ${result.ouId}`);
    return;
  }
  info(`OU '${name}' already exists with ID ${result.ouId}`);
};

const createAndReport = async (
  globals: GlobalOptions,
  rootId: string,
  name: string,
  purpose: string
): Promise<void> => {
  reportOu(await ensureOu(globals, rootId, name, purpose), name);
};

const createSelectedOus = async (
  globals: GlobalOptions,
  selection: OuSelection
): Promise<void> => {
  const rootId = await getRootId(globals);
  if (selection.infrastructure) {
    await createAndReport(globals, rootId, "Infrastructure", "Shared Services");
  }
  if (selection.workloads) {
    await createAndReport(globals, rootId, "Workloads", "Production");
  }
  if (selection.sandbox) {
    await createAndReport(globals, rootId, "Sandbox", "Development");
  }
};

const reportDryRun = (selection: OuSelection): void => {
  const names = Object.entries(selection)
    .filter(([, on]) => on)
    .map(([name]) => name);
  info(`[dry-run] Would create OUs: ${names.join(", ")}`);
};

/**
 * Execute `controltower create-ous`: create the selected landing-zone OUs under
 * the Organizations root (idempotent). Honors `--dry-run`.
 * @param globals - Resolved global options.
 * @param options - The parsed create-ous options.
 */
export const handleCreateOus = async (
  globals: GlobalOptions,
  options: CreateOusOptions
): Promise<void> => {
  const selection = requireOuSelection(options);
  if (globals.dryRun) {
    reportDryRun(selection);
    return;
  }
  await createSelectedOus(globals, selection);
};

/**
 * Register the `controltower` command group (create-ous, provision-account).
 * @param program - The root commander program to attach the commands to.
 */
export const registerControlTower = (program: Command): void => {
  const globals = (): GlobalOptions =>
    resolveGlobalOptions(program.opts<GlobalFlags>());
  const controltower = program
    .command("controltower")
    .description("Manage AWS Control Tower OUs and account provisioning");

  controltower
    .command("create-ous")
    .description("Create landing-zone organizational units")
    .option("-i, --infrastructure", "Create the Infrastructure OU")
    .option("-w, --workloads", "Create the Workloads OU")
    .option("-s, --sandbox", "Create the Sandbox OU")
    .option("-a, --all", "Create all recommended OUs")
    .action(async (options: CreateOusOptions) => {
      await runAction(async () => {
        await handleCreateOus(globals(), options);
      });
    });

  registerProvision(controltower, globals);
  registerEnableControls(controltower, globals);
};
