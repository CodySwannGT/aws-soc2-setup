import {
  CreateUserCommand,
  IdentitystoreClient,
  ListUsersCommand,
} from "@aws-sdk/client-identitystore";

import { buildClientConfig } from "../lib/aws.js";
import { CliError } from "../lib/errors.js";

import type { SsoContext } from "./instance.js";

const identityStoreClient = (context: SsoContext): IdentitystoreClient =>
  new IdentitystoreClient(buildClientConfig(context));

/** A user in the identity store. */
export interface IdentityStoreUser {
  userId: string;
  userName: string;
}

/** Attributes required to create a new identity store user. */
export interface NewUser {
  userName: string;
  firstName: string;
  lastName: string;
  email: string;
}

/**
 * Find a user id by username, returning undefined when no match exists.
 * @param context - AWS region/profile context.
 * @param identityStoreId - The identity store to search.
 * @param userName - The username to look up.
 * @returns The user id, or undefined if not found.
 */
export const findUserId = async (
  context: SsoContext,
  identityStoreId: string,
  userName: string
): Promise<string | undefined> => {
  const result = await identityStoreClient(context).send(
    new ListUsersCommand({
      IdentityStoreId: identityStoreId,
      Filters: [{ AttributePath: "UserName", AttributeValue: userName }],
    })
  );
  return result.Users?.[0]?.UserId;
};

/**
 * Find a user id by username or fail with a clear error.
 * @param context - AWS region/profile context.
 * @param identityStoreId - The identity store to search.
 * @param userName - The username to look up.
 * @returns The user id.
 * @throws {CliError} If the user is not found.
 */
export const requireUserId = async (
  context: SsoContext,
  identityStoreId: string,
  userName: string
): Promise<string> => {
  const userId = await findUserId(context, identityStoreId, userName);
  if (!userId) {
    throw new CliError(`User '${userName}' not found in IAM Identity Center.`);
  }
  return userId;
};

/**
 * List all users in the identity store.
 * @param context - AWS region/profile context.
 * @param identityStoreId - The identity store to list.
 * @returns Every user's id and username.
 */
export const listUsers = async (
  context: SsoContext,
  identityStoreId: string
): Promise<IdentityStoreUser[]> => {
  const result = await identityStoreClient(context).send(
    new ListUsersCommand({ IdentityStoreId: identityStoreId })
  );
  return (result.Users ?? [])
    .filter(user => user.UserId && user.UserName)
    .map(user => ({ userId: user.UserId!, userName: user.UserName! }));
};

/**
 * Create a new user in the identity store.
 * @param context - AWS region/profile context.
 * @param identityStoreId - The identity store to create the user in.
 * @param user - The new user's attributes.
 * @returns The created user's id.
 * @throws {CliError} If creation returns no user id.
 */
export const createUser = async (
  context: SsoContext,
  identityStoreId: string,
  user: NewUser
): Promise<string> => {
  const result = await identityStoreClient(context).send(
    new CreateUserCommand({
      IdentityStoreId: identityStoreId,
      UserName: user.userName,
      DisplayName: `${user.firstName} ${user.lastName}`,
      Name: { GivenName: user.firstName, FamilyName: user.lastName },
      Emails: [{ Type: "Work", Value: user.email, Primary: true }],
    })
  );
  if (!result.UserId) {
    throw new CliError(`Failed to create user '${user.userName}'.`);
  }
  return result.UserId;
};
