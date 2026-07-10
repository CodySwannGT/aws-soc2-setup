import {
  AuditManagerClient,
  CreateAssessmentCommand,
  ListAssessmentFrameworksCommand,
} from "@aws-sdk/client-auditmanager";
import {
  ConfigServiceClient,
  DescribeConfigurationAggregatorsCommand,
  DescribeConfigurationRecordersCommand,
  PutConfigurationAggregatorCommand,
} from "@aws-sdk/client-config-service";
import {
  DescribeOrganizationCommand,
  OrganizationsClient,
} from "@aws-sdk/client-organizations";

import { buildClientConfig } from "../lib/aws.js";
import { info, success, warn } from "../lib/logger.js";

import type { AuditManagerOptions } from "./audit-manager.js";
import type { SecurityContext } from "./config.js";

export {
  AUDIT_MANAGER_AVAILABILITY_DOC,
  classifyAuditManagerError,
  enableAuditManager,
  type AuditManagerOutcome,
} from "./audit-manager.js";

const SOC2_FRAMEWORK_NAME = "SOC 2";
const SOC2_AGGREGATOR_NAME = "SOC2-Config-Aggregator";

/** Inputs shared by the audit configuration steps. */
export type AuditOptions = AuditManagerOptions;

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
