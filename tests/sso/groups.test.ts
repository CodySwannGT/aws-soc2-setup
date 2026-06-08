import {
  CreateGroupCommand,
  CreateGroupMembershipCommand,
  IdentitystoreClient,
  ListGroupMembershipsCommand,
  ListGroupsCommand,
} from "@aws-sdk/client-identitystore";
import { mockClient } from "aws-sdk-client-mock";
import { beforeEach, describe, expect, it } from "vitest";

import { CliError } from "../../src/lib/errors.js";
import {
  ensureGroup,
  ensureGroupMembership,
  isGroupMember,
} from "../../src/sso/groups.js";

const idMock = mockClient(IdentitystoreClient);

const CTX = { region: "us-east-1" };
const STORE_ID = "d-1234567890";
const GROUP_ID = "group-1";
const USER_ID = "user-1";
const GROUP_NAME = "Admins";

describe("sso/groups", () => {
  beforeEach(() => {
    idMock.reset();
  });

  it("ensureGroup returns the existing group without creating it", async () => {
    idMock
      .on(ListGroupsCommand)
      .resolves({ Groups: [{ IdentityStoreId: STORE_ID, GroupId: GROUP_ID }] });
    await expect(
      ensureGroup(CTX, STORE_ID, GROUP_NAME, "desc")
    ).resolves.toEqual({
      groupId: GROUP_ID,
      created: false,
    });
    expect(idMock.commandCalls(CreateGroupCommand)).toHaveLength(0);
  });

  it("ensureGroup creates the group when absent", async () => {
    idMock.on(ListGroupsCommand).resolves({ Groups: [] });
    idMock.on(CreateGroupCommand).resolves({ GroupId: GROUP_ID });
    await expect(
      ensureGroup(CTX, STORE_ID, GROUP_NAME, "desc")
    ).resolves.toEqual({
      groupId: GROUP_ID,
      created: true,
    });
  });

  it("ensureGroup throws CliError when creation returns no id", async () => {
    idMock.on(ListGroupsCommand).resolves({ Groups: [] });
    idMock.on(CreateGroupCommand).resolves({});
    await expect(
      ensureGroup(CTX, STORE_ID, GROUP_NAME, "desc")
    ).rejects.toBeInstanceOf(CliError);
  });

  it("isGroupMember detects an existing membership", async () => {
    idMock.on(ListGroupMembershipsCommand).resolves({
      GroupMemberships: [
        { IdentityStoreId: STORE_ID, MemberId: { UserId: USER_ID } },
      ],
    });
    await expect(isGroupMember(CTX, STORE_ID, GROUP_ID, USER_ID)).resolves.toBe(
      true
    );
  });

  it("ensureGroupMembership adds a new member", async () => {
    idMock.on(ListGroupMembershipsCommand).resolves({ GroupMemberships: [] });
    idMock.on(CreateGroupMembershipCommand).resolves({});
    await expect(
      ensureGroupMembership(CTX, STORE_ID, GROUP_ID, USER_ID)
    ).resolves.toBe("added");
    expect(idMock.commandCalls(CreateGroupMembershipCommand)).toHaveLength(1);
  });

  it("ensureGroupMembership is a no-op for an existing member", async () => {
    idMock.on(ListGroupMembershipsCommand).resolves({
      GroupMemberships: [
        { IdentityStoreId: STORE_ID, MemberId: { UserId: USER_ID } },
      ],
    });
    await expect(
      ensureGroupMembership(CTX, STORE_ID, GROUP_ID, USER_ID)
    ).resolves.toBe("existing");
    expect(idMock.commandCalls(CreateGroupMembershipCommand)).toHaveLength(0);
  });
});
