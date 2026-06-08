import {
  ListInstancesCommand,
  SSOAdminClient,
} from "@aws-sdk/client-sso-admin";
import { mockClient } from "aws-sdk-client-mock";
import { beforeEach, describe, expect, it } from "vitest";

import { CliError } from "../../src/lib/errors.js";
import { getInstance } from "../../src/sso/instance.js";

const ssoMock = mockClient(SSOAdminClient);

const CTX = { region: "us-east-1" };
const INSTANCE_ARN = "arn:aws:sso:::instance/ssoins-123";
const STORE_ID = "d-1234567890";

describe("getInstance", () => {
  beforeEach(() => {
    ssoMock.reset();
  });

  it("returns the first instance ARN and identity store id", async () => {
    ssoMock.on(ListInstancesCommand).resolves({
      Instances: [{ InstanceArn: INSTANCE_ARN, IdentityStoreId: STORE_ID }],
    });
    await expect(getInstance(CTX)).resolves.toEqual({
      instanceArn: INSTANCE_ARN,
      identityStoreId: STORE_ID,
    });
  });

  it("throws CliError when no instance is present", async () => {
    ssoMock.on(ListInstancesCommand).resolves({ Instances: [] });
    await expect(getInstance(CTX)).rejects.toBeInstanceOf(CliError);
  });
});
