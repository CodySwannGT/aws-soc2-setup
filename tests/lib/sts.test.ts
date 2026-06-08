import { GetCallerIdentityCommand, STSClient } from "@aws-sdk/client-sts";
import { mockClient } from "aws-sdk-client-mock";
import { beforeEach, describe, expect, it } from "vitest";

import { CliError } from "../../src/lib/errors.js";
import { getCallerIdentity } from "../../src/lib/sts.js";

const stsMock = mockClient(STSClient);

const REGION = "us-east-1";
const ACCOUNT = "123456789012";
const ARN = "arn:aws:iam::123456789012:user/admin";
const USER_ID = "AIDAEXAMPLE";

describe("getCallerIdentity", () => {
  beforeEach(() => {
    stsMock.reset();
  });

  it("maps a complete AWS response to a CallerIdentity", async () => {
    stsMock
      .on(GetCallerIdentityCommand)
      .resolves({ Account: ACCOUNT, Arn: ARN, UserId: USER_ID });

    const identity = await getCallerIdentity({ region: REGION });

    expect(identity).toEqual({ account: ACCOUNT, arn: ARN, userId: USER_ID });
  });

  it("throws a CliError when the identity is incomplete", async () => {
    stsMock.on(GetCallerIdentityCommand).resolves({ Account: ACCOUNT });

    await expect(getCallerIdentity({ region: REGION })).rejects.toBeInstanceOf(
      CliError
    );
  });
});
