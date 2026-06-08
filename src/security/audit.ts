import {
  AuditManagerClient,
  CreateAssessmentCommand,
  GetAccountStatusCommand,
  ListAssessmentFrameworksCommand,
  RegisterOrganizationAdminAccountCommand,
  UpdateSettingsCommand,
} from "@aws-sdk/client-auditmanager";
import {
  ConfigServiceClient,
  DescribeConfigurationAggregatorsCommand,
  DescribeConfigurationRecordersCommand,
  PutConfigurationAggregatorCommand,
} from "@aws-sdk/client-config-service";
import {
  DescribeOrganizationCommand,
  EnableAWSServiceAccessCommand,
  OrganizationsClient,
  RegisterDelegatedAdministratorCommand,
} from "@aws-sdk/client-organizations";

import { buildClientConfig } from "../lib/aws.js";
import { info, success, warn } from "../lib/logger.js";

import type { SecurityContext } from "./config.js";

const AUDIT_MANAGER_PRINCIPAL = "auditmanager.amazonaws.com";
const SOC2_FRAMEWORK_NAME = "SOC 2";
const SOC2_AGGREGATOR_NAME = "SOC2-Config-Aggregator";
const CONSOLE_SETUP_MARKER = "Please complete AWS Audit Manager setup";

/** Inputs shared by the audit configuration steps. */
export interface AuditOptions {
  accountId: string;
  bucket: string;
  auditAccountId?: string;
  isManagement: boolean;
}

const auditClient = (context: SecurityContext): AuditManagerClient =>
  new AuditManagerClient(buildClientConfig(context));

const orgClient = (context: SecurityContext): OrganizationsClient =>
  new OrganizationsClient(buildClientConfig(context));

const configClient = (context: SecurityContext): ConfigServiceClient =>
  new ConfigServiceClient(buildClientConfig(context));

/**
 * Determine whether the caller is the AWS Organizations management account.
 * @param context - AWS region/profile context.
 * @returns True if `describe-organization` succeeds.
 */
export const isManagementAccount = async (
  context: SecurityContext
): Promise<boolean> => {
  try {
    await orgClient(context).send(new DescribeOrganizationCommand({}));
    return true;
  } catch {
    return false;
  }
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
  options: AuditOptions
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

/**
 *
 */
type AuditManagerOutcome = "enabled" | "needs-console" | "error";

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
    const message = caught instanceof Error ? caught.message : String(caught);
    return message.includes(CONSOLE_SETUP_MARKER) ? "needs-console" : "error";
  }
};

const reportAuditManagerOutcome = (outcome: AuditManagerOutcome): boolean => {
  if (outcome === "enabled") {
    success("Enabled AWS Audit Manager");
    return true;
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

const setupAuditManager = async (
  context: SecurityContext,
  options: AuditOptions
): Promise<boolean> => {
  await registerAuditAdmin(context, options);
  const outcome = await updateAuditManagerSettings(context, options.bucket);
  return reportAuditManagerOutcome(outcome);
};

/**
 * Enable AWS Audit Manager: short-circuits if already active, otherwise registers
 * the (delegated) admin and points assessment reports at the audit bucket.
 * @param context - AWS region/profile context.
 * @param options - Account/bucket/delegation inputs.
 * @returns True if Audit Manager is enabled and ready for a framework.
 */
export const enableAuditManager = async (
  context: SecurityContext,
  options: AuditOptions
): Promise<boolean> => {
  const status = await auditManagerStatus(context);
  if (status === "ACTIVE") {
    info("AWS Audit Manager is already enabled");
    return true;
  }
  return setupAuditManager(context, options);
};

const findSoc2FrameworkId = async (
  context: SecurityContext
): Promise<string | undefined> => {
  const result = await auditClient(context).send(
    new ListAssessmentFrameworksCommand({ frameworkType: "Standard" })
  );
  return (result.frameworkMetadataList ?? []).find(
    framework => framework.name === SOC2_FRAMEWORK_NAME
  )?.id;
};

const createAssessment = async (
  context: SecurityContext,
  options: AuditOptions,
  frameworkId: string
): Promise<void> => {
  try {
    const result = await auditClient(context).send(
      new CreateAssessmentCommand({
        name: "SOC 2 Type 2 Assessment",
        description:
          "Automated SOC 2 Type 2 assessment created by aws-soc2-setup",
        assessmentReportsDestination: {
          destinationType: "S3",
          destination: `s3://${options.bucket}`,
        },
        scope: {
          awsAccounts: [{ id: options.accountId, name: "Primary" }],
        },
        roles: [],
        frameworkId,
      })
    );
    success(
      `Created SOC 2 assessment ${result.assessment?.metadata?.id ?? ""}`.trim()
    );
  } catch {
    warn("Failed to create SOC 2 assessment");
  }
};

/**
 * Create a SOC 2 assessment from the standard SOC 2 framework, if available.
 * @param context - AWS region/profile context.
 * @param options - Account/bucket inputs.
 */
export const createSoc2Framework = async (
  context: SecurityContext,
  options: AuditOptions
): Promise<void> => {
  const frameworkId = await findSoc2FrameworkId(context);
  if (!frameworkId) {
    warn("Could not find the standard SOC 2 framework in Audit Manager");
    return;
  }
  await createAssessment(context, options, frameworkId);
};

const firstConfigRecorderName = async (
  context: SecurityContext
): Promise<string | undefined> => {
  try {
    const result = await configClient(context).send(
      new DescribeConfigurationRecordersCommand({})
    );
    return result.ConfigurationRecorders?.[0]?.name;
  } catch {
    return undefined;
  }
};

const aggregatorExists = async (context: SecurityContext): Promise<boolean> => {
  const result = await configClient(context).send(
    new DescribeConfigurationAggregatorsCommand({})
  );
  return (result.ConfigurationAggregators ?? []).some(
    aggregator =>
      aggregator.ConfigurationAggregatorName === SOC2_AGGREGATOR_NAME
  );
};

const putAggregator = async (
  context: SecurityContext,
  accountId: string
): Promise<void> => {
  await configClient(context).send(
    new PutConfigurationAggregatorCommand({
      ConfigurationAggregatorName: SOC2_AGGREGATOR_NAME,
      OrganizationAggregationSource: {
        RoleArn: `arn:aws:iam::${accountId}:role/aws-service-role/config.amazonaws.com/AWSServiceRoleForConfig`,
        AllAwsRegions: true,
      },
    })
  );
  success(`Created Config aggregator ${SOC2_AGGREGATOR_NAME}`);
};

/**
 * Create the multi-account Config aggregator if AWS Config is enabled and the
 * aggregator does not already exist.
 * @param context - AWS region/profile context.
 * @param accountId - The account that owns the aggregator role.
 */
export const ensureConfigAggregator = async (
  context: SecurityContext,
  accountId: string
): Promise<void> => {
  const recorder = await firstConfigRecorderName(context);
  if (!recorder) {
    warn("AWS Config is not enabled; cannot create aggregator");
    return;
  }
  if (await aggregatorExists(context)) {
    info(`Config aggregator '${SOC2_AGGREGATOR_NAME}' already exists`);
    return;
  }
  await putAggregator(context, accountId);
};
