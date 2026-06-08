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
  bucketExists,
  ensureEncryptedBucket,
  putBucketPolicy,
} from "../../src/lib/s3.js";

const s3Mock = mockClient(S3Client);

const BUCKET = "my-bucket";

describe("lib/s3", () => {
  beforeEach(() => {
    s3Mock.reset();
    vi.spyOn(process.stdout, "write").mockReturnValue(true);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("bucketExists is true when head-bucket succeeds", async () => {
    s3Mock.on(HeadBucketCommand).resolves({});
    await expect(bucketExists({ region: "us-east-1" }, BUCKET)).resolves.toBe(
      true
    );
  });

  it("bucketExists is false when head-bucket throws", async () => {
    s3Mock.on(HeadBucketCommand).rejects(new Error("404"));
    await expect(bucketExists({ region: "us-east-1" }, BUCKET)).resolves.toBe(
      false
    );
  });

  it("ensureEncryptedBucket creates and hardens a missing bucket", async () => {
    s3Mock.on(HeadBucketCommand).rejects(new Error("404"));
    s3Mock.on(CreateBucketCommand).resolves({});
    s3Mock.on(PutBucketEncryptionCommand).resolves({});
    s3Mock.on(PutPublicAccessBlockCommand).resolves({});

    await expect(
      ensureEncryptedBucket({ region: "us-east-1" }, BUCKET)
    ).resolves.toBe(true);
    expect(s3Mock.commandCalls(CreateBucketCommand)).toHaveLength(1);
    expect(s3Mock.commandCalls(PutBucketEncryptionCommand)).toHaveLength(1);
  });

  it("ensureEncryptedBucket sets a LocationConstraint outside us-east-1", async () => {
    s3Mock.on(HeadBucketCommand).rejects(new Error("404"));
    s3Mock.on(CreateBucketCommand).resolves({});
    s3Mock.on(PutBucketEncryptionCommand).resolves({});
    s3Mock.on(PutPublicAccessBlockCommand).resolves({});

    await ensureEncryptedBucket({ region: "eu-west-1" }, BUCKET);
    const call = s3Mock.commandCalls(CreateBucketCommand)[0];
    expect(
      call?.args[0].input.CreateBucketConfiguration?.LocationConstraint
    ).toBe("eu-west-1");
  });

  it("ensureEncryptedBucket is a no-op when the bucket exists", async () => {
    s3Mock.on(HeadBucketCommand).resolves({});
    await expect(
      ensureEncryptedBucket({ region: "us-east-1" }, BUCKET)
    ).resolves.toBe(false);
    expect(s3Mock.commandCalls(CreateBucketCommand)).toHaveLength(0);
  });

  it("putBucketPolicy sends the policy", async () => {
    s3Mock.on(PutBucketPolicyCommand).resolves({});
    await putBucketPolicy({ region: "us-east-1" }, BUCKET, "{}");
    expect(s3Mock.commandCalls(PutBucketPolicyCommand)).toHaveLength(1);
  });
});
