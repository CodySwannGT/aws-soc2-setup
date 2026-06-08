import {
  CreateGroupCommand,
  CreateGroupMembershipCommand,
  CreateUserCommand,
  IdentitystoreClient,
  ListGroupMembershipsCommand,
  ListGroupsCommand,
  ListUsersCommand,
} from "@aws-sdk/client-identitystore";
import {
  CreateAccountAssignmentCommand,
  DescribePermissionSetCommand,
  ListAccountAssignmentsCommand,
  ListInstancesCommand,
  ListPermissionSetsCommand,
  SSOAdminClient,
} from "@aws-sdk/client-sso-admin";
import { mockClient } from "aws-sdk-client-mock";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  handleAssign,
  handleCreateUser,
  handleGroup,
} from "../../src/commands/sso.js";
import type { GlobalOptions } from "../../src/lib/config.js";
import { CliError } from "../../src/lib/errors.js";
import { buildProgram } from "../../src/program.js";

const ssoMock = mockClient(SSOAdminClient);
const idMock = mockClient(IdentitystoreClient);

const STORE_ID = "d-1234567890";
const INSTANCE_ARN = "arn:aws:sso:::instance/ssoins-123";
const PS_ARN = "arn:aws:sso:::permissionSet/ssoins-123/ps-admin";
const PS_NAME = "AWSAdministratorAccess";
const ACCOUNT = "123456789012";
const GROUP_ID = "group-1";
const GROUP_NAME = "Admins";
const USER_NAME = "johndoe";
const CLI = "aws-soc2-setup";

const globals = (overrides: Partial<GlobalOptions> = {}): GlobalOptions => ({
  region: "us-east-1",
  dryRun: false,
  yes: false,
  ...overrides,
});

const primeInstance = (): void => {
  ssoMock.on(ListInstancesCommand).resolves({
    Instances: [{ InstanceArn: INSTANCE_ARN, IdentityStoreId: STORE_ID }],
  });
};

const primePermissions = (): void => {
  ssoMock.on(ListPermissionSetsCommand).resolves({ PermissionSets: [PS_ARN] });
  ssoMock
    .on(DescribePermissionSetCommand)
    .resolves({ PermissionSet: { Name: PS_NAME } });
  ssoMock
    .on(ListAccountAssignmentsCommand)
    .resolves({ AccountAssignments: [] });
  ssoMock.on(CreateAccountAssignmentCommand).resolves({});
};

describe("sso commands", () => {
  beforeEach(() => {
    ssoMock.reset();
    idMock.reset();
    primeInstance();
    vi.spyOn(process.stdout, "write").mockReturnValue(true);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("create-user creates a user", async () => {
    idMock.on(CreateUserCommand).resolves({ UserId: "user-1" });
    await handleCreateUser(globals(), {
      userName: USER_NAME,
      firstName: "John",
      lastName: "Doe",
      email: "john@example.com",
    });
    expect(idMock.commandCalls(CreateUserCommand)).toHaveLength(1);
  });

  it("group creates the group and assigns a permission set to an account", async () => {
    idMock.on(ListGroupsCommand).resolves({ Groups: [] });
    idMock.on(CreateGroupCommand).resolves({ GroupId: GROUP_ID });
    primePermissions();
    await handleGroup(globals(), {
      groupName: GROUP_NAME,
      permissionSet: PS_NAME,
      accountId: ACCOUNT,
    });
    expect(ssoMock.commandCalls(CreateAccountAssignmentCommand)).toHaveLength(
      1
    );
  });

  it("group adds all users when --all-users is set", async () => {
    idMock.on(ListGroupsCommand).resolves({
      Groups: [{ IdentityStoreId: STORE_ID, GroupId: GROUP_ID }],
    });
    idMock.on(ListUsersCommand).resolves({
      Users: [
        { IdentityStoreId: STORE_ID, UserId: "u1", UserName: "a" },
        { IdentityStoreId: STORE_ID, UserId: "u2", UserName: "b" },
      ],
    });
    idMock.on(ListGroupMembershipsCommand).resolves({ GroupMemberships: [] });
    idMock.on(CreateGroupMembershipCommand).resolves({});
    await handleGroup(globals(), {
      groupName: GROUP_NAME,
      permissionSet: PS_NAME,
      allUsers: true,
    });
    expect(idMock.commandCalls(CreateGroupMembershipCommand)).toHaveLength(2);
  });

  it("assign grants a permission set to a user", async () => {
    idMock.on(ListUsersCommand).resolves({
      Users: [{ IdentityStoreId: STORE_ID, UserId: "user-1" }],
    });
    primePermissions();
    await handleAssign(globals(), {
      userName: USER_NAME,
      accountId: ACCOUNT,
      permissionSet: PS_NAME,
    });
    const call = ssoMock.commandCalls(CreateAccountAssignmentCommand)[0];
    expect(call?.args[0].input.PrincipalType).toBe("USER");
  });

  it("assign rejects an invalid account before any AWS call", async () => {
    await expect(
      handleAssign(globals(), {
        userName: USER_NAME,
        accountId: "abc",
        permissionSet: PS_NAME,
      })
    ).rejects.toBeInstanceOf(CliError);
    expect(ssoMock.commandCalls(ListInstancesCommand)).toHaveLength(0);
  });

  it("group adds named users", async () => {
    idMock.on(ListGroupsCommand).resolves({
      Groups: [{ IdentityStoreId: STORE_ID, GroupId: GROUP_ID }],
    });
    idMock.on(ListUsersCommand).resolves({
      Users: [{ IdentityStoreId: STORE_ID, UserId: "u1", UserName: "alice" }],
    });
    idMock.on(ListGroupMembershipsCommand).resolves({ GroupMemberships: [] });
    idMock.on(CreateGroupMembershipCommand).resolves({});
    await handleGroup(globals(), {
      groupName: GROUP_NAME,
      permissionSet: PS_NAME,
      users: ["alice"],
    });
    expect(idMock.commandCalls(CreateGroupMembershipCommand)).toHaveLength(1);
  });

  it("group reports existing members and assignments without changes", async () => {
    idMock.on(ListGroupsCommand).resolves({
      Groups: [{ IdentityStoreId: STORE_ID, GroupId: GROUP_ID }],
    });
    idMock.on(ListUsersCommand).resolves({
      Users: [{ IdentityStoreId: STORE_ID, UserId: "u1", UserName: "alice" }],
    });
    idMock.on(ListGroupMembershipsCommand).resolves({
      GroupMemberships: [
        { IdentityStoreId: STORE_ID, MemberId: { UserId: "u1" } },
      ],
    });
    ssoMock
      .on(ListPermissionSetsCommand)
      .resolves({ PermissionSets: [PS_ARN] });
    ssoMock
      .on(DescribePermissionSetCommand)
      .resolves({ PermissionSet: { Name: PS_NAME } });
    ssoMock.on(ListAccountAssignmentsCommand).resolves({
      AccountAssignments: [{ PrincipalId: GROUP_ID, PrincipalType: "GROUP" }],
    });
    await handleGroup(globals(), {
      groupName: GROUP_NAME,
      permissionSet: PS_NAME,
      allUsers: true,
      accountId: ACCOUNT,
    });
    expect(idMock.commandCalls(CreateGroupMembershipCommand)).toHaveLength(0);
    expect(ssoMock.commandCalls(CreateAccountAssignmentCommand)).toHaveLength(
      0
    );
  });

  it("runs create-user end-to-end via the program", async () => {
    idMock.on(CreateUserCommand).resolves({ UserId: "user-1" });
    await buildProgram().parseAsync([
      "node",
      CLI,
      "sso",
      "create-user",
      "-u",
      USER_NAME,
      "-f",
      "John",
      "-l",
      "Doe",
      "-e",
      "john@example.com",
    ]);
    expect(idMock.commandCalls(CreateUserCommand)).toHaveLength(1);
  });

  it("runs group end-to-end via the program", async () => {
    idMock.on(ListGroupsCommand).resolves({ Groups: [] });
    idMock.on(CreateGroupCommand).resolves({ GroupId: GROUP_ID });
    primePermissions();
    await buildProgram().parseAsync([
      "node",
      CLI,
      "sso",
      "group",
      "-g",
      GROUP_NAME,
      "-a",
      ACCOUNT,
    ]);
    expect(ssoMock.commandCalls(CreateAccountAssignmentCommand)).toHaveLength(
      1
    );
  });

  it("runs assign end-to-end via the program", async () => {
    idMock.on(ListUsersCommand).resolves({
      Users: [{ IdentityStoreId: STORE_ID, UserId: "user-1" }],
    });
    primePermissions();
    await buildProgram().parseAsync([
      "node",
      CLI,
      "sso",
      "assign",
      "-u",
      USER_NAME,
      "-a",
      ACCOUNT,
    ]);
    expect(ssoMock.commandCalls(CreateAccountAssignmentCommand)).toHaveLength(
      1
    );
  });
});

describe("registerSso", () => {
  it("registers the sso command group with its subcommands", () => {
    const sso = buildProgram().commands.find(
      command => command.name() === "sso"
    );
    const subcommands = (sso?.commands ?? []).map(command => command.name());
    expect(subcommands).toEqual(
      expect.arrayContaining(["create-user", "group", "assign"])
    );
  });
});
