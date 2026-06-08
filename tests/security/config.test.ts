import {
  ConfigServiceClient,
  PutConfigurationRecorderCommand,
  PutDeliveryChannelCommand,
  StartConfigurationRecorderCommand,
} from "@aws-sdk/client-config-service";
import {
  AttachRolePolicyCommand,
  CreateRoleCommand,
  GetRoleCommand,
  IAMClient,
} from "@aws-sdk/client-iam";
import {
  CreateBucketCommand,
  HeadBucketCommand,
  PutBucketEncryptionCommand,
  PutBucketPolicyCommand,
  PutPublicAccessBlockCommand,
  S3Client,
} from "@aws-sdk/client-s3";
import { mockClient } from "aws-sdk-client-mock";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  buildConfigBucketPolicy,
  enableAwsConfig,
} from "../../src/security/config.js";

const s3Mock = mockClient(S3Client);
const iamMock = mockClient(IAMClient);
const configMock = mockClient(ConfigServiceClient);

const CTX = { region: "us-east-1" };
const ACCOUNT = "123456789012";
const ROLE_ARN = "arn:aws:iam::123456789012:role/AWSConfigRole";

const primeBucket = (): void => {
  s3Mock.on(HeadBucketCommand).rejects(new Error("404"));
  s3Mock.on(CreateBucketCommand).resolves({});
  s3Mock.on(PutBucketEncryptionCommand).resolves({});
  s3Mock.on(PutPublicAccessBlockCommand).resolves({});
  s3Mock.on(PutBucketPolicyCommand).resolves({});
};

const primeConfigService = (): void => {
  configMock.on(PutConfigurationRecorderCommand).resolves({});
  configMock.on(PutDeliveryChannelCommand).resolves({});
  configMock.on(StartConfigurationRecorderCommand).resolves({});
};

describe("buildConfigBucketPolicy", () => {
  it("includes ACL-check and delivery statements scoped to the account", () => {
    const policy = JSON.parse(
      buildConfigBucketPolicy("config-bucket", ACCOUNT)
    );
    expect(policy.Statement).toHaveLength(2);
    expect(policy.Statement[0].Action).toBe("s3:GetBucketAcl");
    expect(policy.Statement[1].Resource).toContain(ACCOUNT);
  });
});

describe("enableAwsConfig", () => {
  beforeEach(() => {
    s3Mock.reset();
    iamMock.reset();
    configMock.reset();
    primeBucket();
    primeConfigService();
    vi.spyOn(process.stdout, "write").mockReturnValue(true);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("creates the role and starts the recorder when no role exists", async () => {
    iamMock.on(GetRoleCommand).rejects(new Error("NoSuchEntity"));
    iamMock
      .on(CreateRoleCommand)
      .resolves({ Role: { Arn: ROLE_ARN } } as never);
    iamMock.on(AttachRolePolicyCommand).resolves({});

    await enableAwsConfig(CTX, ACCOUNT);

    expect(iamMock.commandCalls(CreateRoleCommand)).toHaveLength(1);
    expect(
      configMock.commandCalls(StartConfigurationRecorderCommand)
    ).toHaveLength(1);
  });

  it("reuses an existing role", async () => {
    iamMock.on(GetRoleCommand).resolves({ Role: { Arn: ROLE_ARN } } as never);

    await enableAwsConfig(CTX, ACCOUNT);

    expect(iamMock.commandCalls(CreateRoleCommand)).toHaveLength(0);
    expect(
      configMock.commandCalls(PutConfigurationRecorderCommand)
    ).toHaveLength(1);
  });
});
