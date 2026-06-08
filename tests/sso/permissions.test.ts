import {
  CreateAccountAssignmentCommand,
  DescribePermissionSetCommand,
  ListAccountAssignmentsCommand,
  ListPermissionSetsCommand,
  SSOAdminClient,
} from "@aws-sdk/client-sso-admin";
import { mockClient } from "aws-sdk-client-mock";
import { beforeEach, describe, expect, it } from "vitest";

import { CliError } from "../../src/lib/errors.js";
import {
  assignmentExists,
  ensureAccountAssignment,
  findPermissionSetArn,
  requirePermissionSetArn,
} from "../../src/sso/permissions.js";

const ssoMock = mockClient(SSOAdminClient);

const CTX = { region: "us-east-1" };
const INSTANCE_ARN = "arn:aws:sso:::instance/ssoins-123";
const PS_ARN = "arn:aws:sso:::permissionSet/ssoins-123/ps-admin";
const PS_NAME = "AWSAdministratorAccess";
const ACCOUNT = "123456789012";
const GROUP_ID = "group-1";

const primePermissionSets = (): void => {
  ssoMock.on(ListPermissionSetsCommand).resolves({ PermissionSets: [PS_ARN] });
  ssoMock
    .on(DescribePermissionSetCommand)
    .resolves({ PermissionSet: { Name: PS_NAME } });
};

describe("sso/permissions", () => {
  beforeEach(() => {
    ssoMock.reset();
  });

  it("findPermissionSetArn matches by name", async () => {
    primePermissionSets();
    await expect(
      findPermissionSetArn(CTX, INSTANCE_ARN, PS_NAME)
    ).resolves.toBe(PS_ARN);
  });

  it("findPermissionSetArn returns undefined when no name matches", async () => {
    primePermissionSets();
    await expect(
      findPermissionSetArn(CTX, INSTANCE_ARN, "PowerUserAccess")
    ).resolves.toBeUndefined();
  });

  it("requirePermissionSetArn throws CliError when absent", async () => {
    ssoMock.on(ListPermissionSetsCommand).resolves({ PermissionSets: [] });
    await expect(
      requirePermissionSetArn(CTX, INSTANCE_ARN, PS_NAME)
    ).rejects.toBeInstanceOf(CliError);
  });

  it("assignmentExists matches principal id and type", async () => {
    ssoMock.on(ListAccountAssignmentsCommand).resolves({
      AccountAssignments: [{ PrincipalId: GROUP_ID, PrincipalType: "GROUP" }],
    });
    await expect(
      assignmentExists(CTX, INSTANCE_ARN, {
        accountId: ACCOUNT,
        permissionSetArn: PS_ARN,
        principalId: GROUP_ID,
        principalType: "GROUP",
      })
    ).resolves.toBe(true);
  });

  it("ensureAccountAssignment creates a new assignment", async () => {
    ssoMock
      .on(ListAccountAssignmentsCommand)
      .resolves({ AccountAssignments: [] });
    ssoMock.on(CreateAccountAssignmentCommand).resolves({});
    await expect(
      ensureAccountAssignment(CTX, INSTANCE_ARN, {
        accountId: ACCOUNT,
        permissionSetArn: PS_ARN,
        principalId: GROUP_ID,
        principalType: "GROUP",
      })
    ).resolves.toBe("created");
  });

  it("ensureAccountAssignment is a no-op when already assigned", async () => {
    ssoMock.on(ListAccountAssignmentsCommand).resolves({
      AccountAssignments: [{ PrincipalId: GROUP_ID, PrincipalType: "GROUP" }],
    });
    await expect(
      ensureAccountAssignment(CTX, INSTANCE_ARN, {
        accountId: ACCOUNT,
        permissionSetArn: PS_ARN,
        principalId: GROUP_ID,
        principalType: "GROUP",
      })
    ).resolves.toBe("existing");
    expect(ssoMock.commandCalls(CreateAccountAssignmentCommand)).toHaveLength(
      0
    );
  });
});
