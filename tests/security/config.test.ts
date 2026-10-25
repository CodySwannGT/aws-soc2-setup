import {
  ConfigServiceClient,
  InsufficientDeliveryPolicyException,
  InvalidRoleException,
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

  describe("when the role was just created", () => {
    const roleNotPropagated = (): Error =>
      new InsufficientDeliveryPolicyException({
        message: `Insufficient delivery policy to s3 bucket: config-bucket-${ACCOUNT}, unable to assume role: ${ROLE_ARN}`,
        $metadata: {},
      });

    beforeEach(() => {
      iamMock.on(GetRoleCommand).rejects(new Error("NoSuchEntity"));
      iamMock
        .on(CreateRoleCommand)
        .resolves({ Role: { Arn: ROLE_ARN } } as never);
      iamMock.on(AttachRolePolicyCommand).resolves({});
    });

    it("retries recorder and delivery channel setup while IAM propagates", async () => {
      configMock
        .on(PutConfigurationRecorderCommand)
        .rejectsOnce(
          new InvalidRoleException({
            message: "unable to assume role",
            $metadata: {},
          })
        )
        .resolves({});
      configMock
        .on(PutDeliveryChannelCommand)
        .rejectsOnce(roleNotPropagated())
        .resolves({});
      const delay = vi.fn(async () => undefined);

      await enableAwsConfig(CTX, ACCOUNT, delay);

      expect(
        configMock.commandCalls(PutConfigurationRecorderCommand)
      ).toHaveLength(2);
      expect(configMock.commandCalls(PutDeliveryChannelCommand)).toHaveLength(
        2
      );
      expect(delay).toHaveBeenCalledTimes(2);
      expect(
        configMock.commandCalls(StartConfigurationRecorderCommand)
      ).toHaveLength(1);
    });

    it("backs off with increasing delays and eventually gives up", async () => {
      configMock.on(PutDeliveryChannelCommand).rejects(roleNotPropagated());
      const delay = vi.fn(async () => undefined);

      await expect(enableAwsConfig(CTX, ACCOUNT, delay)).rejects.toThrow(
        /unable to assume role/
      );

      const waits = delay.mock.calls.map(([ms]) => ms as number);
      expect(waits.length).toBeGreaterThan(1);
      expect(waits).toEqual([...waits].sort((a, b) => a - b));
      expect(configMock.commandCalls(PutDeliveryChannelCommand)).toHaveLength(
        waits.length + 1
      );
    });

    it("does not retry unrelated errors", async () => {
      configMock
        .on(PutDeliveryChannelCommand)
        .rejects(new Error("NoSuchBucketException"));
      const delay = vi.fn(async () => undefined);

      await expect(enableAwsConfig(CTX, ACCOUNT, delay)).rejects.toThrow(
        "NoSuchBucketException"
      );
      expect(delay).not.toHaveBeenCalled();
    });
  });

  it("does not retry when the role already existed", async () => {
    iamMock.on(GetRoleCommand).resolves({ Role: { Arn: ROLE_ARN } } as never);
    configMock
      .on(PutConfigurationRecorderCommand)
      .rejects(
        new InvalidRoleException({ message: "bad role", $metadata: {} })
      );
    const delay = vi.fn(async () => undefined);

    await expect(enableAwsConfig(CTX, ACCOUNT, delay)).rejects.toThrow(
      "bad role"
    );
    expect(delay).not.toHaveBeenCalled();
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
