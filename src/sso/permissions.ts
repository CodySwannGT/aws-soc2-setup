import {
  CreateAccountAssignmentCommand,
  DescribePermissionSetCommand,
  ListAccountAssignmentsCommand,
  ListPermissionSetsCommand,
} from "@aws-sdk/client-sso-admin";

import { CliError } from "../lib/errors.js";

import { ssoAdminClient, type SsoContext } from "./instance.js";

/** Principal a permission set can be assigned to. */
export type PrincipalType = "USER" | "GROUP";

/** A request to assign a permission set in an account to a principal. */
export interface AssignmentRequest {
  accountId: string;
  permissionSetArn: string;
  principalType: PrincipalType;
  principalId: string;
}

/**
 * Find a permission set ARN by its name, returning undefined when absent.
 * @param context - AWS region/profile context.
 * @param instanceArn - The Identity Center instance ARN.
 * @param name - The permission set name to find.
 * @returns The permission set ARN, or undefined if not found.
 */
export const findPermissionSetArn = async (
  context: SsoContext,
  instanceArn: string,
  name: string
): Promise<string | undefined> => {
  const client = ssoAdminClient(context);
  const list = await client.send(
    new ListPermissionSetsCommand({ InstanceArn: instanceArn })
  );
  for (const arn of list.PermissionSets ?? []) {
    const described = await client.send(
      new DescribePermissionSetCommand({
        InstanceArn: instanceArn,
        PermissionSetArn: arn,
      })
    );
    if (described.PermissionSet?.Name === name) {
      return arn;
    }
  }
  return undefined;
};

/**
 * Report whether an account assignment already exists for a principal.
 * @param context - AWS region/profile context.
 * @param instanceArn - The Identity Center instance ARN.
 * @param request - The assignment to check for.
 * @returns True if the assignment already exists.
 */
export const assignmentExists = async (
  context: SsoContext,
  instanceArn: string,
  request: AssignmentRequest
): Promise<boolean> => {
  const result = await ssoAdminClient(context).send(
    new ListAccountAssignmentsCommand({
      InstanceArn: instanceArn,
      AccountId: request.accountId,
      PermissionSetArn: request.permissionSetArn,
    })
  );
  return (result.AccountAssignments ?? []).some(
    assignment =>
      assignment.PrincipalId === request.principalId &&
      assignment.PrincipalType === request.principalType
  );
};

/** Outcome of an account assignment request. */
export type AssignmentResult = "created" | "existing";

/**
 * Create an account assignment if it does not already exist (idempotent).
 * @param context - AWS region/profile context.
 * @param instanceArn - The Identity Center instance ARN.
 * @param request - The assignment to ensure.
 * @returns "created" if newly created, "existing" if already present.
 */
export const ensureAccountAssignment = async (
  context: SsoContext,
  instanceArn: string,
  request: AssignmentRequest
): Promise<AssignmentResult> => {
  if (await assignmentExists(context, instanceArn, request)) {
    return "existing";
  }
  await ssoAdminClient(context).send(
    new CreateAccountAssignmentCommand({
      InstanceArn: instanceArn,
      TargetId: request.accountId,
      TargetType: "AWS_ACCOUNT",
      PermissionSetArn: request.permissionSetArn,
      PrincipalType: request.principalType,
      PrincipalId: request.principalId,
    })
  );
  return "created";
};

/**
 * Resolve a permission set name to its ARN or fail with a clear error.
 * @param context - AWS region/profile context.
 * @param instanceArn - The Identity Center instance ARN.
 * @param name - The permission set name.
 * @returns The permission set ARN.
 * @throws {CliError} If the permission set is not found.
 */
export const requirePermissionSetArn = async (
  context: SsoContext,
  instanceArn: string,
  name: string
): Promise<string> => {
  const arn = await findPermissionSetArn(context, instanceArn, name);
  if (!arn) {
    throw new CliError(`Permission set '${name}' not found.`);
  }
  return arn;
};
