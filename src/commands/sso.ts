import type { Command } from "commander";

import { resolveGlobalOptions, type GlobalFlags } from "../lib/config.js";
import type { GlobalOptions } from "../lib/config.js";
import { info, success, warn } from "../lib/logger.js";
import { runAction } from "../lib/run.js";
import { requireAccountId } from "../lib/validate.js";
import { registerSsoConfigCommands } from "./sso-config.js";
import {
  ensureGroup,
  ensureGroupMembership,
  type EnsuredGroup,
  type MembershipResult,
} from "../sso/groups.js";
import { getInstance, type IdentityCenterInstance } from "../sso/instance.js";
import {
  ensureAccountAssignment,
  requirePermissionSetArn,
  type AssignmentResult,
  type PrincipalType,
} from "../sso/permissions.js";
import {
  createUser,
  findUserId,
  listUsers,
  requireUserId,
} from "../sso/users.js";

const DEFAULT_PERMISSION_SET = "AWSAdministratorAccess";
const DEFAULT_GROUP_DESCRIPTION = "Group created by aws-soc2-setup";

/** Options for `sso create-user`. */
export interface CreateUserOptions {
  userName: string;
  firstName: string;
  lastName: string;
  email: string;
}

/** Options for `sso group`. */
export interface GroupOptions {
  groupName: string;
  description?: string;
  users?: string[];
  allUsers?: boolean;
  accountId?: string;
  permissionSet: string;
}

/** Options for `sso assign`. */
export interface AssignOptions {
  userName: string;
  accountId: string;
  permissionSet: string;
}

const reportMembership = (result: MembershipResult, userName: string): void => {
  if (result === "existing") {
    info(`  ${userName} is already a member`);
    return;
  }
  success(`  Added ${userName} to the group`);
};

const reportAssignment = (
  result: AssignmentResult,
  principal: string,
  accountId: string,
  permissionSet: string
): void => {
  if (result === "existing") {
    info(
      `Assignment already exists for ${principal} in ${accountId} (${permissionSet})`
    );
    return;
  }
  success(`Assigned ${permissionSet} to ${principal} in ${accountId}`);
};

/**
 * Execute `sso create-user`: create a user in the identity store.
 * @param globals - Resolved global options.
 * @param options - The parsed create-user options.
 */
export const handleCreateUser = async (
  globals: GlobalOptions,
  options: CreateUserOptions
): Promise<void> => {
  const instance = await getInstance(globals);
  const userId = await createUser(globals, instance.identityStoreId, {
    userName: options.userName,
    firstName: options.firstName,
    lastName: options.lastName,
    email: options.email,
  });
  success(`Created user '${options.userName}' with ID ${userId}`);
  info(
    "Set the initial password in the IAM Identity Center console (Users → Reset password)."
  );
};

const addAllUsers = async (
  globals: GlobalOptions,
  identityStoreId: string,
  groupId: string
): Promise<void> => {
  const users = await listUsers(globals, identityStoreId);
  for (const user of users) {
    const result = await ensureGroupMembership(
      globals,
      identityStoreId,
      groupId,
      user.userId
    );
    reportMembership(result, user.userName);
  }
};

const addNamedUser = async (
  globals: GlobalOptions,
  identityStoreId: string,
  groupId: string,
  userName: string
): Promise<void> => {
  const userId = await findUserId(globals, identityStoreId, userName);
  if (!userId) {
    warn(`User '${userName}' not found. Skipping.`);
    return;
  }
  reportMembership(
    await ensureGroupMembership(globals, identityStoreId, groupId, userId),
    userName
  );
};

const addNamedUsers = async (
  globals: GlobalOptions,
  identityStoreId: string,
  groupId: string,
  userNames: string[]
): Promise<void> => {
  for (const userName of userNames) {
    await addNamedUser(globals, identityStoreId, groupId, userName);
  }
};

const addRequestedUsers = async (
  globals: GlobalOptions,
  identityStoreId: string,
  groupId: string,
  options: GroupOptions
): Promise<void> => {
  if (options.allUsers) {
    await addAllUsers(globals, identityStoreId, groupId);
    return;
  }
  if (options.users && options.users.length > 0) {
    await addNamedUsers(globals, identityStoreId, groupId, options.users);
  }
};

const assignToGroup = async (
  globals: GlobalOptions,
  instance: IdentityCenterInstance,
  groupId: string,
  options: GroupOptions
): Promise<void> => {
  const accountId = requireAccountId(options.accountId ?? "");
  const permissionSetArn = await requirePermissionSetArn(
    globals,
    instance.instanceArn,
    options.permissionSet
  );
  const result = await ensureAccountAssignment(globals, instance.instanceArn, {
    accountId,
    permissionSetArn,
    principalType: "GROUP",
    principalId: groupId,
  });
  reportAssignment(result, options.groupName, accountId, options.permissionSet);
};

const reportGroup = (group: EnsuredGroup, groupName: string): void => {
  if (group.created) {
    success(`Created group '${groupName}' with ID ${group.groupId}`);
    return;
  }
  info(`Group '${groupName}' already exists with ID ${group.groupId}`);
};

/**
 * Execute `sso group`: ensure a group exists, optionally add users (named or
 * all), and optionally assign a permission set to the group for an account.
 * @param globals - Resolved global options.
 * @param options - The parsed group options.
 */
export const handleGroup = async (
  globals: GlobalOptions,
  options: GroupOptions
): Promise<void> => {
  const instance = await getInstance(globals);
  const group = await ensureGroup(
    globals,
    instance.identityStoreId,
    options.groupName,
    options.description ?? DEFAULT_GROUP_DESCRIPTION
  );
  reportGroup(group, options.groupName);
  await addRequestedUsers(
    globals,
    instance.identityStoreId,
    group.groupId,
    options
  );
  if (options.accountId) {
    await assignToGroup(globals, instance, group.groupId, options);
  }
};

const assignToPrincipal = async (
  globals: GlobalOptions,
  instance: IdentityCenterInstance,
  principalId: string,
  principalType: PrincipalType,
  accountId: string,
  permissionSet: string
): Promise<AssignmentResult> => {
  const permissionSetArn = await requirePermissionSetArn(
    globals,
    instance.instanceArn,
    permissionSet
  );
  return ensureAccountAssignment(globals, instance.instanceArn, {
    accountId,
    permissionSetArn,
    principalType,
    principalId,
  });
};

/**
 * Execute `sso assign`: assign a permission set to a user for an account.
 * @param globals - Resolved global options.
 * @param options - The parsed assign options.
 */
export const handleAssign = async (
  globals: GlobalOptions,
  options: AssignOptions
): Promise<void> => {
  const accountId = requireAccountId(options.accountId);
  const instance = await getInstance(globals);
  const userId = await requireUserId(
    globals,
    instance.identityStoreId,
    options.userName
  );
  const result = await assignToPrincipal(
    globals,
    instance,
    userId,
    "USER",
    accountId,
    options.permissionSet
  );
  reportAssignment(result, options.userName, accountId, options.permissionSet);
};

/**
 * Register the `sso` command group (create-user, group, assign,
 * configure-profile, set-start-url).
 * @param program - The root commander program to attach the commands to.
 */
export const registerSso = (program: Command): void => {
  const globals = (): GlobalOptions =>
    resolveGlobalOptions(program.opts<GlobalFlags>());
  const sso = program
    .command("sso")
    .description(
      "Manage IAM Identity Center users, groups, and permission sets"
    );

  sso
    .command("create-user")
    .description("Create a user in IAM Identity Center")
    .requiredOption("-u, --user-name <username>", "Username")
    .requiredOption("-f, --first-name <firstName>", "First name")
    .requiredOption("-l, --last-name <lastName>", "Last name")
    .requiredOption("-e, --email <email>", "Work email address")
    .action(async (options: CreateUserOptions) => {
      await runAction(async () => {
        await handleCreateUser(globals(), options);
      });
    });

  sso
    .command("group")
    .description(
      "Create/ensure a group, add users, and assign a permission set"
    )
    .requiredOption("-g, --group-name <name>", "Group display name")
    .option("-d, --description <text>", "Group description")
    .option("--users <usernames...>", "Usernames to add to the group")
    .option("--all-users", "Add every identity store user to the group")
    .option("-a, --account-id <id>", "Account to grant the group access to")
    .option(
      "-r, --permission-set <name>",
      "Permission set to assign",
      DEFAULT_PERMISSION_SET
    )
    .action(async (options: GroupOptions) => {
      await runAction(async () => {
        await handleGroup(globals(), options);
      });
    });

  sso
    .command("assign")
    .description("Assign a permission set to a user for an account")
    .requiredOption("-u, --user-name <username>", "Username")
    .requiredOption("-a, --account-id <id>", "Account ID (12 digits)")
    .option(
      "-r, --permission-set <name>",
      "Permission set to assign",
      DEFAULT_PERMISSION_SET
    )
    .action(async (options: AssignOptions) => {
      await runAction(async () => {
        await handleAssign(globals(), options);
      });
    });

  registerSsoConfigCommands(sso);
};
