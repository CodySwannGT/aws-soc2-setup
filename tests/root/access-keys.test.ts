import {
  DeleteAccessKeyCommand,
  IAMClient,
  ListAccessKeysCommand,
} from "@aws-sdk/client-iam";
import { mockClient } from "aws-sdk-client-mock";
import { beforeEach, describe, expect, it } from "vitest";

import {
  deleteAccessKey,
  listRootAccessKeyIds,
} from "../../src/root/access-keys.js";

const iamMock = mockClient(IAMClient);

const CTX = { region: "us-east-1" };

describe("root/access-keys", () => {
  beforeEach(() => {
    iamMock.reset();
  });

  it("listRootAccessKeyIds returns the key ids", async () => {
    iamMock.on(ListAccessKeysCommand).resolves({
      AccessKeyMetadata: [{ AccessKeyId: "AKIA1" }, { AccessKeyId: "AKIA2" }],
    });
    await expect(listRootAccessKeyIds(CTX)).resolves.toEqual([
      "AKIA1",
      "AKIA2",
    ]);
  });

  it("listRootAccessKeyIds returns empty when there are none", async () => {
    iamMock.on(ListAccessKeysCommand).resolves({ AccessKeyMetadata: [] });
    await expect(listRootAccessKeyIds(CTX)).resolves.toEqual([]);
  });

  it("deleteAccessKey sends the delete command", async () => {
    iamMock.on(DeleteAccessKeyCommand).resolves({});
    await deleteAccessKey(CTX, "AKIA1");
    expect(iamMock.commandCalls(DeleteAccessKeyCommand)).toHaveLength(1);
  });
});
