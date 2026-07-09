import {
  AlreadyInOrganizationException,
  AWSOrganizationsNotInUseException,
  CreateOrganizationCommand,
  CreateOrganizationalUnitCommand,
  DescribeOrganizationCommand,
  ListOrganizationalUnitsForParentCommand,
  ListRootsCommand,
  OrganizationsClient,
} from "@aws-sdk/client-organizations";

import { buildClientConfig } from "../lib/aws.js";
import type { GlobalOptions } from "../lib/config.js";
import { CliError } from "../lib/errors.js";

/** AWS context for Control Tower / Organizations operations. */
export type ControlTowerContext = Pick<GlobalOptions, "region" | "profile">;

/** Feature set required for Control Tower and full Organizations APIs. */
export const ORGANIZATION_FEATURE_SET = "ALL" as const;

/** Snapshot of an AWS Organization. */
export interface OrganizationInfo {
  id: string;
  arn?: string;
  managementAccountId?: string;
  featureSet?: string;
}

/** Result of ensuring an organization exists. */
export interface EnsuredOrganization {
  organization: OrganizationInfo;
  created: boolean;
}

const orgClient = (context: ControlTowerContext): OrganizationsClient =>
  new OrganizationsClient(buildClientConfig(context));

const isOrganizationsNotInUse = (error: unknown): boolean =>
  error instanceof AWSOrganizationsNotInUseException ||
  (error instanceof Error &&
    error.name === "AWSOrganizationsNotInUseException");

const isAlreadyInOrganization = (error: unknown): boolean =>
  error instanceof AlreadyInOrganizationException ||
  (error instanceof Error && error.name === "AlreadyInOrganizationException");

const toOrganizationInfo = (organization: {
  Id?: string;
  Arn?: string;
  MasterAccountId?: string;
  FeatureSet?: string;
}): OrganizationInfo => {
  if (!organization.Id) {
    throw new CliError(
      "AWS Organizations returned an organization without an id."
    );
  }
  return {
    id: organization.Id,
    arn: organization.Arn,
    managementAccountId: organization.MasterAccountId,
    featureSet: organization.FeatureSet,
  };
};

/**
 * Describe the caller's AWS Organization, if one exists.
 * @param context - AWS region/profile context.
 * @returns The organization info, or `undefined` when Organizations is not in use.
 */
export const describeOrganization = async (
  context: ControlTowerContext
): Promise<OrganizationInfo | undefined> => {
  try {
    const result = await orgClient(context).send(
      new DescribeOrganizationCommand({})
    );
    if (!result.Organization) {
      return undefined;
    }
    return toOrganizationInfo(result.Organization);
  } catch (error) {
    if (isOrganizationsNotInUse(error)) {
      return undefined;
    }
    throw error;
  }
};

/**
 * Create an AWS Organization with feature set `ALL` if the account is not
 * already in one (idempotent). Existing infra in the management account is
 * left untouched — this only enables Organizations on the caller account.
 * @param context - AWS region/profile context.
 * @returns The organization and whether it was created in this call.
 * @throws {CliError} If creation returns no organization id.
 */
export const ensureOrganization = async (
  context: ControlTowerContext
): Promise<EnsuredOrganization> => {
  const existing = await describeOrganization(context);
  if (existing) {
    return { organization: existing, created: false };
  }

  try {
    const result = await orgClient(context).send(
      new CreateOrganizationCommand({ FeatureSet: ORGANIZATION_FEATURE_SET })
    );
    if (!result.Organization) {
      throw new CliError("CreateOrganization returned no organization.");
    }
    return {
      organization: toOrganizationInfo(result.Organization),
      created: true,
    };
  } catch (error) {
    if (isAlreadyInOrganization(error)) {
      const raced = await describeOrganization(context);
      if (raced) {
        return { organization: raced, created: false };
      }
    }
    throw error;
  }
};

/**
 * Resolve the AWS Organizations root id.
 * @param context - AWS region/profile context.
 * @returns The root id.
 * @throws {CliError} If Organizations is not enabled / no root is found.
 */
export const getRootId = async (
  context: ControlTowerContext
): Promise<string> => {
  const result = await orgClient(context).send(new ListRootsCommand({}));
  const rootId = result.Roots?.[0]?.Id;
  if (!rootId) {
    throw new CliError(
      "Could not find an AWS Organizations root. Ensure Organizations is enabled."
    );
  }
  return rootId;
};

/**
 * Find an organizational unit id by name under a parent.
 * @param context - AWS region/profile context.
 * @param parentId - The parent (root or OU) id.
 * @param name - The OU display name.
 * @returns The OU id, or undefined if not found.
 */
export const findOuId = async (
  context: ControlTowerContext,
  parentId: string,
  name: string
): Promise<string | undefined> => {
  const result = await orgClient(context).send(
    new ListOrganizationalUnitsForParentCommand({ ParentId: parentId })
  );
  return result.OrganizationalUnits?.find(ou => ou.Name === name)?.Id;
};

/** Result of ensuring an OU exists. */
export interface EnsuredOu {
  ouId: string;
  created: boolean;
}

/**
 * Create an organizational unit if it does not already exist (idempotent),
 * tagging new OUs with their purpose.
 * @param context - AWS region/profile context.
 * @param parentId - The parent (root or OU) id.
 * @param name - The OU display name.
 * @param purpose - The value for the `Purpose` tag on creation.
 * @returns The OU id and whether it was created.
 * @throws {CliError} If creation returns no id.
 */
export const ensureOu = async (
  context: ControlTowerContext,
  parentId: string,
  name: string,
  purpose: string
): Promise<EnsuredOu> => {
  const existing = await findOuId(context, parentId, name);
  if (existing) {
    return { ouId: existing, created: false };
  }
  const result = await orgClient(context).send(
    new CreateOrganizationalUnitCommand({
      ParentId: parentId,
      Name: name,
      Tags: [{ Key: "Purpose", Value: purpose }],
    })
  );
  if (!result.OrganizationalUnit?.Id) {
    throw new CliError(`Failed to create OU '${name}'.`);
  }
  return { ouId: result.OrganizationalUnit.Id, created: true };
};
