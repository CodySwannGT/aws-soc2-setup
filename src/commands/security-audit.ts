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
    info(
      "For new accounts after 2026-04-30, use Config Conformance Packs, Security Hub, and Control Tower controls instead of Audit Manager."
    );
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
 * Audit Manager (+ SOC 2 framework) when still available, and a multi-account
 * Config aggregator. New accounts cannot enable Audit Manager after 2026-04-30.
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
      "Configure audit reporting (Config aggregator; Audit Manager if already available)"
    )
    .option("-b, --bucket <name>", "S3 bucket for audit reports")
    .option(
      "--audit-account <id>",
      "Audit account ID for delegated administration"
    )
    .option(
      "-a, --audit-manager",
      "Enable AWS Audit Manager (skipped for new accounts after 2026-04-30)"
    )
    .option(
      "-f, --framework",
      "Create the SOC 2 framework assessment (requires Audit Manager)"
    )
    .option("--aggregator", "Set up a multi-account Config aggregator")
    .option("--skip-audit-manager", "Continue if Audit Manager setup fails")
    .action(async (options: SecurityAuditOptions) => {
      await runAction(async () => {
        await handleSecurityAudit(globals(), options);
      });
    });
};
