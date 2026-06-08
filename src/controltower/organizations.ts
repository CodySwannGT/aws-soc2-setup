import {
  CreateOrganizationalUnitCommand,
  ListOrganizationalUnitsForParentCommand,
  ListRootsCommand,
  OrganizationsClient,
} from "@aws-sdk/client-organizations";

import { buildClientConfig } from "../lib/aws.js";
import type { GlobalOptions } from "../lib/config.js";
import { CliError } from "../lib/errors.js";

/** AWS context for Control Tower / Organizations operations. */
export type ControlTowerContext = Pick<GlobalOptions, "region" | "profile">;

const orgClient = (context: ControlTowerContext): OrganizationsClient =>
  new OrganizationsClient(buildClientConfig(context));

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
