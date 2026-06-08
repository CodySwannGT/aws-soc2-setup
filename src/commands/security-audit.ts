import type { Command } from "commander";

import type { GlobalOptions } from "../lib/config.js";
import { info } from "../lib/logger.js";
import { runAction } from "../lib/run.js";
import { ensureEncryptedBucket } from "../lib/s3.js";
import { getCallerIdentity } from "../lib/sts.js";
import {
  createSoc2Framework,
  enableAuditManager,
  ensureConfigAggregator,
  isManagementAccount,
  type AuditOptions,
} from "../security/audit.js";

/** Options for `security audit`. */
export interface SecurityAuditOptions {
  bucket?: string;
  auditAccount?: string;
  auditManager?: boolean;
  framework?: boolean;
  aggregator?: boolean;
  skipAuditManager?: boolean;
}

const applyFramework = async (
  globals: GlobalOptions,
  enabled: boolean,
  auditOptions: AuditOptions
): Promise<void> => {
  if (!enabled) {
    info("Audit Manager not enabled; skipping SOC 2 framework");
    return;
  }
  await createSoc2Framework(globals, auditOptions);
};

const runAudit = async (
  globals: GlobalOptions,
  options: SecurityAuditOptions,
  accountId: string,
  bucket: string,
  isManagement: boolean
): Promise<void> => {
  const auditOptions: AuditOptions = {
    accountId,
    bucket,
    auditAccountId: options.auditAccount,
    isManagement,
  };
  const created = await ensureEncryptedBucket(globals, bucket);
  const enabled = options.auditManager
    ? await enableAuditManager(globals, auditOptions)
    : false;
  info(
    created ? `Created audit bucket ${bucket}` : `Using audit bucket ${bucket}`
  );
  if (options.framework) {
    await applyFramework(globals, enabled, auditOptions);
  }
  if (options.aggregator) {
    await ensureConfigAggregator(globals, accountId);
  }
};

/**
 * Execute `security audit`: ensure an audit-reports bucket, optionally enable
 * Audit Manager (+ SOC 2 framework) and a multi-account Config aggregator.
 * Honors `--dry-run`.
 * @param globals - Resolved global options.
 * @param options - The parsed audit options.
 */
export const handleSecurityAudit = async (
  globals: GlobalOptions,
  options: SecurityAuditOptions
): Promise<void> => {
  const identity = await getCallerIdentity(globals);
  const bucket = options.bucket ?? `audit-reports-${identity.account}`;
  const isManagement = await isManagementAccount(globals);
  if (globals.dryRun) {
    info(`[dry-run] Would configure audit reporting using bucket ${bucket}`);
    return;
  }
  await runAudit(globals, options, identity.account, bucket, isManagement);
};

/**
 * Register the `security audit` subcommand.
 * @param security - The `security` parent command.
 * @param globals - Resolver for global options from the root program.
 */
export const registerSecurityAudit = (
  security: Command,
  globals: () => GlobalOptions
): void => {
  security
    .command("audit")
    .description(
      "Configure audit reporting (Audit Manager, SOC 2 framework, Config aggregator)"
    )
    .option("-b, --bucket <name>", "S3 bucket for audit reports")
    .option(
      "--audit-account <id>",
      "Audit account ID for delegated administration"
    )
    .option("-a, --audit-manager", "Enable AWS Audit Manager")
    .option("-f, --framework", "Create the SOC 2 framework assessment")
    .option("--aggregator", "Set up a multi-account Config aggregator")
    .option("--skip-audit-manager", "Continue if Audit Manager setup fails")
    .action(async (options: SecurityAuditOptions) => {
      await runAction(async () => {
        await handleSecurityAudit(globals(), options);
      });
    });
};
