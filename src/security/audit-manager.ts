import {
  AuditManagerClient,
  GetAccountStatusCommand,
  RegisterAccountCommand,
  RegisterOrganizationAdminAccountCommand,
  UpdateSettingsCommand,
} from "@aws-sdk/client-auditmanager";
import {
  EnableAWSServiceAccessCommand,
  OrganizationsClient,
  RegisterDelegatedAdministratorCommand,
} from "@aws-sdk/client-organizations";

import { buildClientConfig } from "../lib/aws.js";
import { info, success, warn } from "../lib/logger.js";

import type { SecurityContext } from "./config.js";

const AUDIT_MANAGER_PRINCIPAL = "auditmanager.amazonaws.com";
const CONSOLE_SETUP_MARKER = "Please complete AWS Audit Manager setup";
const MAINTENANCE_MODE_MARKERS = [
  "maintenance mode",
  "no longer open to new customers",
  "cannot enable Audit Manager for new accounts",
  "cannot enable Audit Manager for new accounts or in additional AWS Regions",
] as const;

/** Docs AWS points to for Audit Manager availability and Config alternatives. */
export const AUDIT_MANAGER_AVAILABILITY_DOC =
  "https://docs.aws.amazon.com/audit-manager/latest/userguide/audit-manager-availability-change.html";

/** Inputs shared by Audit Manager enablement. */
export interface AuditManagerOptions {
  accountId: string;
  bucket: string;
  auditAccountId?: string;
  isManagement: boolean;
}

/** Outcome of attempting to enable Audit Manager in this account/region. */
export type AuditManagerOutcome =
  | "enabled"
  | "needs-console"
  | "unavailable"
  | "error";

const auditClient = (context: SecurityContext): AuditManagerClient =>
  new AuditManagerClient(buildClientConfig(context));

const orgClient = (context: SecurityContext): OrganizationsClient =>
  new OrganizationsClient(buildClientConfig(context));

/**
 * Classify an Audit Manager API error message into a setup outcome.
 * @param message - Error message from the SDK or AWS CLI.
 * @returns The matching outcome (defaults to error).
 */
export const classifyAuditManagerError = (
  message: string
): Exclude<AuditManagerOutcome, "enabled"> => {
  const lower = message.toLowerCase();
  if (
    MAINTENANCE_MODE_MARKERS.some(marker =>
      lower.includes(marker.toLowerCase())
    )
  ) {
    return "unavailable";
  }
  if (message.includes(CONSOLE_SETUP_MARKER)) {
    return "needs-console";
  }
  return "error";
};

const errorMessage = (caught: unknown): string =>
  caught instanceof Error ? caught.message : String(caught);

const tryOrg = async (op: () => Promise<unknown>): Promise<boolean> => {
  try {
    await op();
    return true;
  } catch {
    return false;
  }
};

const registerAuditAdmin = async (
  context: SecurityContext,
  options: AuditManagerOptions
): Promise<boolean> => {
  if (options.isManagement && options.auditAccountId) {
    const auditAccountId = options.auditAccountId;
    await tryOrg(() =>
      orgClient(context).send(
        new EnableAWSServiceAccessCommand({
          ServicePrincipal: AUDIT_MANAGER_PRINCIPAL,
        })
      )
    );
    return tryOrg(() =>
      orgClient(context).send(
        new RegisterDelegatedAdministratorCommand({
          ServicePrincipal: AUDIT_MANAGER_PRINCIPAL,
          AccountId: auditAccountId,
        })
      )
    );
  }
  return tryOrg(() =>
    auditClient(context).send(
      new RegisterOrganizationAdminAccountCommand({
        adminAccountId: options.accountId,
      })
    )
  );
};

const registerAuditManagerAccount = async (
  context: SecurityContext
): Promise<AuditManagerOutcome | undefined> => {
  try {
    await auditClient(context).send(new RegisterAccountCommand({}));
    return undefined;
  } catch (caught) {
    return classifyAuditManagerError(errorMessage(caught));
  }
};

const updateAuditManagerSettings = async (
  context: SecurityContext,
  bucket: string
): Promise<AuditManagerOutcome> => {
  try {
    await auditClient(context).send(
      new UpdateSettingsCommand({
        defaultAssessmentReportsDestination: {
          destinationType: "S3",
          destination: `s3://${bucket}`,
        },
      })
    );
    return "enabled";
  } catch (caught) {
    return classifyAuditManagerError(errorMessage(caught));
  }
};

const reportUnavailableAlternatives = (): void => {
  warn(
    "AWS Audit Manager is in maintenance mode and cannot be enabled for new accounts (as of 2026-04-30)."
  );
  info(`See: ${AUDIT_MANAGER_AVAILABILITY_DOC}`);
  info(
    "AWS recommends AWS Config Conformance Packs for resource compliance monitoring (no SOC 2 pack today)."
  );
  info(
    "Also use Security Hub standards, Control Tower controls, and Config aggregators for technical evidence."
  );
  info(
    "For end-to-end SOC 2 evidence packaging, AWS points to partner GRC tools (e.g. Vanta, Drata) alongside Config."
  );
};

const reportAuditManagerOutcome = (outcome: AuditManagerOutcome): boolean => {
  if (outcome === "enabled") {
    success("Enabled AWS Audit Manager");
    return true;
  }
  if (outcome === "unavailable") {
    reportUnavailableAlternatives();
    return false;
  }
  if (outcome === "needs-console") {
    warn(
      "AWS Audit Manager requires one-time console setup (Get started). Re-run after completing it."
    );
    return false;
  }
  warn("Failed to enable AWS Audit Manager; continuing");
  return false;
};

const auditManagerStatus = async (
  context: SecurityContext
): Promise<string | undefined> => {
  try {
    const result = await auditClient(context).send(
      new GetAccountStatusCommand({})
    );
    return result.status;
  } catch {
    return undefined;
  }
};

const setupAuditManager = async (
  context: SecurityContext,
  options: AuditManagerOptions
): Promise<boolean> => {
  await registerAuditAdmin(context, options);
  return reportAuditManagerOutcome(
    (await registerAuditManagerAccount(context)) ??
      (await updateAuditManagerSettings(context, options.bucket))
  );
};

/**
 * Enable AWS Audit Manager: short-circuits if already active, otherwise registers
 * the (delegated) admin and points assessment reports at the audit bucket.
 * New accounts cannot enable Audit Manager after 2026-04-30 (maintenance mode).
 * @param context - AWS region/profile context.
 * @param options - Account/bucket/delegation inputs.
 * @returns True if Audit Manager is enabled and ready for a framework.
 */
export const enableAuditManager = async (
  context: SecurityContext,
  options: AuditManagerOptions
): Promise<boolean> => {
  const status = await auditManagerStatus(context);
  if (status === "ACTIVE") {
    info("AWS Audit Manager is already enabled");
    return true;
  }
  return setupAuditManager(context, options);
};
