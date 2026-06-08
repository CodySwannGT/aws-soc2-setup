import {
  DescribeKeyCommand,
  DisableKeyRotationCommand,
  EnableKeyRotationCommand,
  GetKeyPolicyCommand,
  GetKeyRotationStatusCommand,
  KMSClient,
  PutKeyPolicyCommand,
} from "@aws-sdk/client-kms";
import { mockClient } from "aws-sdk-client-mock";
import { beforeEach, describe, expect, it } from "vitest";

import { CliError } from "../../src/lib/errors.js";
import {
  describeKey,
  getKeyPolicy,
  getKeyRotationStatus,
  putKeyPolicy,
  setKeyRotation,
} from "../../src/kms/keys.js";
import type { KeyPolicy } from "../../src/kms/policy.js";

const kmsMock = mockClient(KMSClient);

const CTX = { region: "us-east-1" };
const KEY_ID = "1234abcd-12ab-34cd-56ef-1234567890ab";
const KEY_ARN = `arn:aws:kms:us-east-1:123456789012:key/${KEY_ID}`;

const samplePolicy: KeyPolicy = {
  Version: "2012-10-17",
  Statement: [
    {
      Sid: "Enable IAM",
      Effect: "Allow",
      Principal: { AWS: "root" },
      Action: "kms:*",
      Resource: "*",
    },
  ],
};

describe("kms/keys", () => {
  beforeEach(() => {
    kmsMock.reset();
  });

  it("describeKey returns the ARN and state", async () => {
    kmsMock.on(DescribeKeyCommand).resolves({
      KeyMetadata: { KeyId: KEY_ID, Arn: KEY_ARN, KeyState: "Enabled" },
    });
    await expect(describeKey(CTX, KEY_ID)).resolves.toEqual({
      arn: KEY_ARN,
      state: "Enabled",
    });
  });

  it("describeKey throws CliError when metadata is missing", async () => {
    kmsMock.on(DescribeKeyCommand).resolves({});
    await expect(describeKey(CTX, KEY_ID)).rejects.toBeInstanceOf(CliError);
  });

  it("getKeyPolicy parses the returned document", async () => {
    kmsMock
      .on(GetKeyPolicyCommand)
      .resolves({ Policy: JSON.stringify(samplePolicy) });
    await expect(getKeyPolicy(CTX, KEY_ID)).resolves.toEqual(samplePolicy);
  });

  it("getKeyPolicy throws CliError when no policy is returned", async () => {
    kmsMock.on(GetKeyPolicyCommand).resolves({});
    await expect(getKeyPolicy(CTX, KEY_ID)).rejects.toBeInstanceOf(CliError);
  });

  it("putKeyPolicy serializes the policy to the request", async () => {
    kmsMock.on(PutKeyPolicyCommand).resolves({});
    await putKeyPolicy(CTX, KEY_ID, samplePolicy);
    const call = kmsMock.commandCalls(PutKeyPolicyCommand)[0];
    expect(call?.args[0].input.Policy).toBe(JSON.stringify(samplePolicy));
  });

  it("setKeyRotation sends the enable command when enabling", async () => {
    kmsMock.on(EnableKeyRotationCommand).resolves({});
    await setKeyRotation(CTX, KEY_ID, true);
    expect(kmsMock.commandCalls(EnableKeyRotationCommand)).toHaveLength(1);
  });

  it("setKeyRotation sends the disable command when disabling", async () => {
    kmsMock.on(DisableKeyRotationCommand).resolves({});
    await setKeyRotation(CTX, KEY_ID, false);
    expect(kmsMock.commandCalls(DisableKeyRotationCommand)).toHaveLength(1);
  });

  it("getKeyRotationStatus reports the boolean, defaulting to false", async () => {
    kmsMock
      .on(GetKeyRotationStatusCommand)
      .resolves({ KeyRotationEnabled: true });
    await expect(getKeyRotationStatus(CTX, KEY_ID)).resolves.toBe(true);

    kmsMock.reset();
    kmsMock.on(GetKeyRotationStatusCommand).resolves({});
    await expect(getKeyRotationStatus(CTX, KEY_ID)).resolves.toBe(false);
  });
});
