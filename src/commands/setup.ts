import type { Command } from "commander";

import { DEFAULT_VAULT_NAME } from "../backup/policy.js";
import { resolveGlobalOptions, type GlobalFlags } from "../lib/config.js";
import type { GlobalOptions } from "../lib/config.js";
import { info } from "../lib/logger.js";
import { runAction } from "../lib/run.js";
import { SETUP_PLAN, type SetupStep } from "../orchestrator/plan.js";
import { handleBackup, type BackupCommandOptions } from "./backup.js";
import {
  handleEnableControls,
  type EnableControlsOptions,
} from "./controltower-controls.js";
import { handleCreateOus, type CreateOusOptions } from "./controltower.js";
import { handleCreateOrganization } from "./controltower-organization.js";
import {
  handleRegisterOu,
  type RegisterOuOptions,
} from "./controltower-register-ou.js";
import {
  handleSecurityAudit,
  type SecurityAuditOptions,
} from "./security-audit.js";
import {
  handleSecurityEnable,
  type SecurityEnableOptions,
} from "./security.js";

/** Options for the `setup` orchestrator. */
export interface SetupOptions {
  ou?: string;
  centralAccount?: string;
  adminAccount?: string;
  auditAccount?: string;
}

/** The automatable step handlers, injectable so the orchestration is testable. */
export interface SetupRunners {
  createOrganization: (g: GlobalOptions) => Promise<void>;
  createOus: (g: GlobalOptions, o: CreateOusOptions) => Promise<void>;
  registerOu: (g: GlobalOptions, o: RegisterOuOptions) => Promise<void>;
  enableSecurity: (g: GlobalOptions, o: SecurityEnableOptions) => Promise<void>;
  enableControls: (g: GlobalOptions, o: EnableControlsOptions) => Promise<void>;
  configureBackup: (g: GlobalOptions, o: BackupCommandOptions) => Promise<void>;
  configureAudit: (g: GlobalOptions, o: SecurityAuditOptions) => Promise<void>;
}

const defaultRunners: SetupRunners = {
  createOrganization: handleCreateOrganization,
  createOus: handleCreateOus,
  registerOu: handleRegisterOu,
  enableSecurity: handleSecurityEnable,
  enableControls: handleEnableControls,
  configureBackup: handleBackup,
  configureAudit: handleSecurityAudit,
};

const renderStep = (step: SetupStep): string =>
  `  [${step.number}] ${step.kind === "manual" ? "manual" : "auto  "} ${step.title}: ${step.detail}`;

const printPlan = (): void => {
  info("AWS Control Tower SOC 2 setup plan:");
  for (const step of SETUP_PLAN) {
    info(renderStep(step));
  }
};

const runAutomated = async (
  globals: GlobalOptions,
  options: SetupOptions,
  runners: SetupRunners
): Promise<void> => {
  await runners.createOrganization(globals);
  await runners.createOus(globals, { all: true });
  if (options.ou) {
    await runners.registerOu(globals, { ou: options.ou, wait: true });
  }
  await runners.enableSecurity(globals, { all: true });
  if (options.ou) {
    await runners.enableControls(globals, {
      ou: options.ou,
      soc2Type: "both",
      baseline: "recommended",
    });
  }
  if (options.centralAccount && options.adminAccount) {
    await runners.configureBackup(globals, {
      centralAccount: options.centralAccount,
      adminAccount: options.adminAccount,
      vaultName: DEFAULT_VAULT_NAME,
    });
  }
  if (options.auditAccount) {
    await runners.configureAudit(globals, {
      auditAccount: options.auditAccount,
      auditManager: true,
      framework: true,
      aggregator: true,
    });
  }
};

/**
 * Execute `setup`: print the ordered SOC 2 setup plan and run the automatable
 * steps (OUs, OU registration, security services, controls, backup, audit) by
 * composing the domain commands. Manual/console steps are printed as guidance.
 * Honors `--dry-run` (plan only).
 * @param globals - Resolved global options.
 * @param options - Inputs for the automatable steps.
 * @param runners - Step handlers (defaults to the real commands).
 */
export const handleSetup = async (
  globals: GlobalOptions,
  options: SetupOptions,
  runners: SetupRunners = defaultRunners
): Promise<void> => {
  printPlan();
  if (globals.dryRun) {
    return;
  }
  await runAutomated(globals, options, runners);
};

/**
 * Register the `setup` orchestrator command.
 * @param program - The root commander program to attach the command to.
 */
export const registerSetup = (program: Command): void => {
  program
    .command("setup")
    .description(
      "Orchestrate the SOC 2 Control Tower setup (plan + automatable steps)"
    )
    .option("--ou <ouId>", "OU id for Control Tower controls (step 11)")
    .option("--central-account <id>", "Central backup account id (step 12)")
    .option("--admin-account <id>", "Backup administrator account id (step 12)")
    .option("--audit-account <id>", "Audit account id (step 13)")
    .action(async (options: SetupOptions) => {
      await runAction(async () => {
        await handleSetup(
          resolveGlobalOptions(program.opts<GlobalFlags>()),
          options
        );
      });
    });
};
