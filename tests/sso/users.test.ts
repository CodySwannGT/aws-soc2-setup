import {
  CreateUserCommand,
  IdentitystoreClient,
  ListUsersCommand,
} from "@aws-sdk/client-identitystore";
import { mockClient } from "aws-sdk-client-mock";
import { beforeEach, describe, expect, it } from "vitest";

import { CliError } from "../../src/lib/errors.js";
import {
  createUser,
  findUserId,
  listUsers,
  requireUserId,
} from "../../src/sso/users.js";

const idMock = mockClient(IdentitystoreClient);

const CTX = { region: "us-east-1" };
const STORE_ID = "d-1234567890";
const USER_ID = "user-abc";
const USER_NAME = "johndoe";

describe("sso/users", () => {
  beforeEach(() => {
    idMock.reset();
  });

  it("findUserId returns the matching user id", async () => {
    idMock
      .on(ListUsersCommand)
      .resolves({ Users: [{ IdentityStoreId: STORE_ID, UserId: USER_ID }] });
    await expect(findUserId(CTX, STORE_ID, USER_NAME)).resolves.toBe(USER_ID);
  });

  it("findUserId returns undefined when there is no match", async () => {
    idMock.on(ListUsersCommand).resolves({ Users: [] });
    await expect(findUserId(CTX, STORE_ID, USER_NAME)).resolves.toBeUndefined();
  });

  it("requireUserId throws CliError when the user is missing", async () => {
    idMock.on(ListUsersCommand).resolves({ Users: [] });
    await expect(
      requireUserId(CTX, STORE_ID, USER_NAME)
    ).rejects.toBeInstanceOf(CliError);
  });

  it("listUsers maps and drops users missing id or name", async () => {
    idMock.on(ListUsersCommand).resolves({
      Users: [
        { IdentityStoreId: STORE_ID, UserId: USER_ID, UserName: USER_NAME },
        { IdentityStoreId: STORE_ID, UserId: "no-name" },
      ],
    });
    await expect(listUsers(CTX, STORE_ID)).resolves.toEqual([
      { userId: USER_ID, userName: USER_NAME },
    ]);
  });

  it("createUser returns the new user id", async () => {
    idMock.on(CreateUserCommand).resolves({ UserId: USER_ID });
    await expect(
      createUser(CTX, STORE_ID, {
        userName: USER_NAME,
        firstName: "John",
        lastName: "Doe",
        email: "john@example.com",
      })
    ).resolves.toBe(USER_ID);
  });

  it("createUser throws CliError when no id is returned", async () => {
    idMock.on(CreateUserCommand).resolves({});
    await expect(
      createUser(CTX, STORE_ID, {
        userName: USER_NAME,
        firstName: "John",
        lastName: "Doe",
        email: "john@example.com",
      })
    ).rejects.toBeInstanceOf(CliError);
  });
});
