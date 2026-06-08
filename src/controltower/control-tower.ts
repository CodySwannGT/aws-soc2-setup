import {
  ControlTowerClient,
  EnableControlCommand,
} from "@aws-sdk/client-controltower";
import {
  DescribeOrganizationCommand,
  ListRootsCommand,
  OrganizationsClient,
} from "@aws-sdk/client-organizations";
import {
  BatchEnableStandardsCommand,
  DescribeStandardsCommand,
  EnableSecurityHubCommand,
  SecurityHubClient,
} from "@aws-sdk/client-securityhub";

import { buildClientConfig } from "../lib/aws.js";
import { CliError } from "../lib/errors.js";

import type { ControlTowerContext } from "./organizations.js";

const FSBP_NAME = "AWS Foundational Security Best Practices v1.0.0";
const CIS_NAME = "CIS AWS Foundations Benchmark v1.2.0";
const ORG_ID_PATTERN = /(o-[a-z0-9]+)/;

const ctClient = (context: ControlTowerContext): ControlTowerClient =>
  new ControlTowerClient(buildClientConfig(context));

const orgClient = (context: ControlTowerContext): OrganizationsClient =>
  new OrganizationsClient(buildClientConfig(context));

const hubClient = (context: ControlTowerContext): SecurityHubClient =>
  new SecurityHubClient(buildClientConfig(context));

const organizationIdFromDescribe = async (
  context: ControlTowerContext
): Promise<string | undefined> => {
  try {
    const result = await orgClient(context).send(
      new DescribeOrganizationCommand({})
    );
    return result.Organization?.Id;
  } catch {
    return undefined;
  }
};

const organizationIdFromRoots = async (
  context: ControlTowerContext
): Promise<string | undefined> => {
  try {
    const result = await orgClient(context).send(new ListRootsCommand({}));
    const arn = result.Roots?.[0]?.Arn ?? "";
    return ORG_ID_PATTERN.exec(arn)?.[1];
  } catch {
    return undefined;
  }
};

/**
 * Resolve the organization id, trying describe-organization then the root ARN.
 * @param context - AWS region/profile context.
 * @returns The organization id (`o-...`).
 * @throws {CliError} If the organization id cannot be determined.
 */
export const getOrganizationId = async (
  context: ControlTowerContext
): Promise<string> => {
  const direct = await organizationIdFromDescribe(context);
  const orgId = direct ?? (await organizationIdFromRoots(context));
  if (!orgId) {
    throw new CliError("Could not determine organization ID.");
  }
  return orgId;
};

const enableControl = async (
  context: ControlTowerContext,
  controlIdentifier: string,
  targetIdentifier: string
): Promise<boolean> => {
  try {
    await ctClient(context).send(
      new EnableControlCommand({ controlIdentifier, targetIdentifier })
    );
    return true;
  } catch {
    return false;
  }
};

/**
 * Try each control-identifier format in order until one enables successfully.
 * @param context - AWS region/profile context.
 * @param formats - Ordered candidate control identifiers.
 * @param targetIdentifier - The target OU ARN.
 * @returns True if any format succeeded.
 */
export const enableControlWithFormats = async (
  context: ControlTowerContext,
  formats: string[],
  targetIdentifier: string
): Promise<boolean> => {
  for (const format of formats) {
    if (await enableControl(context, format, targetIdentifier)) {
      return true;
    }
  }
  return false;
};

const findStandardArn = async (
  context: ControlTowerContext,
  name: string
): Promise<string | undefined> => {
  const result = await hubClient(context).send(
    new DescribeStandardsCommand({})
  );
  return result.Standards?.find(standard => standard.Name === name)
    ?.StandardsArn;
};

const enableStandard = async (
  context: ControlTowerContext,
  name: string
): Promise<boolean> => {
  const arn = await findStandardArn(context, name);
  if (!arn) {
    return false;
  }
  try {
    await hubClient(context).send(
      new BatchEnableStandardsCommand({
        StandardsSubscriptionRequests: [{ StandardsArn: arn }],
      })
    );
    return true;
  } catch {
    return false;
  }
};

/**
 * Fallback path: enable Security Hub and the AWS Foundational Security Best
 * Practices standard (then CIS if FSBP is unavailable).
 * @param context - AWS region/profile context.
 * @returns True if Security Hub plus a standard were enabled.
 */
export const enableSecurityHubFallback = async (
  context: ControlTowerContext
): Promise<boolean> => {
  try {
    await hubClient(context).send(new EnableSecurityHubCommand({}));
  } catch {
    return false;
  }
  return (
    (await enableStandard(context, FSBP_NAME)) ||
    (await enableStandard(context, CIS_NAME))
  );
};
