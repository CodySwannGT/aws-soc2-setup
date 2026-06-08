import {
  CreateGroupCommand,
  CreateGroupMembershipCommand,
  IdentitystoreClient,
  ListGroupMembershipsCommand,
  ListGroupsCommand,
} from "@aws-sdk/client-identitystore";

import { buildClientConfig } from "../lib/aws.js";
import { CliError } from "../lib/errors.js";
import { collectPaged } from "../lib/paginate.js";

import type { SsoContext } from "./instance.js";

const identityStoreClient = (context: SsoContext): IdentitystoreClient =>
  new IdentitystoreClient(buildClientConfig(context));

/** Result of ensuring a group exists. */
export interface EnsuredGroup {
  groupId: string;
  created: boolean;
}

/**
 * Find a group id by display name, returning undefined when no match exists.
 * @param context - AWS region/profile context.
 * @param identityStoreId - The identity store to search.
 * @param displayName - The group display name.
 * @returns The group id, or undefined if not found.
 */
export const findGroupId = async (
  context: SsoContext,
  identityStoreId: string,
  displayName: string
): Promise<string | undefined> => {
  const result = await identityStoreClient(context).send(
    new ListGroupsCommand({
      IdentityStoreId: identityStoreId,
      Filters: [{ AttributePath: "DisplayName", AttributeValue: displayName }],
    })
  );
  return result.Groups?.[0]?.GroupId;
};

/**
 * Ensure a group exists, creating it if absent (idempotent).
 * @param context - AWS region/profile context.
 * @param identityStoreId - The identity store to use.
 * @param displayName - The group display name.
 * @param description - The group description used on creation.
 * @returns The group id and whether it was created.
 * @throws {CliError} If the group could not be created.
 */
export const ensureGroup = async (
  context: SsoContext,
  identityStoreId: string,
  displayName: string,
  description: string
): Promise<EnsuredGroup> => {
  const existing = await findGroupId(context, identityStoreId, displayName);
  if (existing) {
    return { groupId: existing, created: false };
  }
  const result = await identityStoreClient(context).send(
    new CreateGroupCommand({
      IdentityStoreId: identityStoreId,
      DisplayName: displayName,
      Description: description,
    })
  );
  if (!result.GroupId) {
    throw new CliError(`Failed to create group '${displayName}'.`);
  }
  return { groupId: result.GroupId, created: true };
};

/**
 * Report whether a user is already a member of a group.
 * @param context - AWS region/profile context.
 * @param identityStoreId - The identity store to use.
 * @param groupId - The group to check.
 * @param userId - The user to check for.
 * @returns True if the user is a member.
 */
export const isGroupMember = async (
  context: SsoContext,
  identityStoreId: string,
  groupId: string,
  userId: string
): Promise<boolean> => {
  const memberships = await collectPaged(async token => {
    const result = await identityStoreClient(context).send(
      new ListGroupMembershipsCommand({
        IdentityStoreId: identityStoreId,
        GroupId: groupId,
        NextToken: token,
      })
    );
    return { items: result.GroupMemberships ?? [], next: result.NextToken };
  });
  return memberships.some(membership => membership.MemberId?.UserId === userId);
};

/** Outcome of adding a user to a group. */
export type MembershipResult = "added" | "existing";

/**
 * Add a user to a group if not already a member (idempotent).
 * @param context - AWS region/profile context.
 * @param identityStoreId - The identity store to use.
 * @param groupId - The group to add to.
 * @param userId - The user to add.
 * @returns "added" if newly added, "existing" if already a member.
 */
export const ensureGroupMembership = async (
  context: SsoContext,
  identityStoreId: string,
  groupId: string,
  userId: string
): Promise<MembershipResult> => {
  if (await isGroupMember(context, identityStoreId, groupId, userId)) {
    return "existing";
  }
  await identityStoreClient(context).send(
    new CreateGroupMembershipCommand({
      IdentityStoreId: identityStoreId,
      GroupId: groupId,
      MemberId: { UserId: userId },
    })
  );
  return "added";
};
