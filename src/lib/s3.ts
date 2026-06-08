import {
  type BucketLocationConstraint,
  CreateBucketCommand,
  HeadBucketCommand,
  PutBucketEncryptionCommand,
  PutBucketPolicyCommand,
  PutPublicAccessBlockCommand,
  S3Client,
} from "@aws-sdk/client-s3";

import { buildClientConfig } from "./aws.js";
import type { GlobalOptions } from "./config.js";
import { warn } from "./logger.js";

/** AWS context (region + optional profile) every S3 call needs. */
export type S3Context = Pick<GlobalOptions, "region" | "profile">;

const s3Client = (context: S3Context): S3Client =>
  new S3Client(buildClientConfig(context));

/**
 * Report whether a bucket already exists and is accessible.
 * @param context - AWS region/profile context.
 * @param bucket - The bucket name.
 * @returns True if the bucket exists.
 */
export const bucketExists = async (
  context: S3Context,
  bucket: string
): Promise<boolean> => {
  try {
    await s3Client(context).send(new HeadBucketCommand({ Bucket: bucket }));
    return true;
  } catch {
    return false;
  }
};

const createBucket = async (
  context: S3Context,
  bucket: string
): Promise<void> => {
  const input =
    context.region === "us-east-1"
      ? { Bucket: bucket }
      : {
          Bucket: bucket,
          CreateBucketConfiguration: {
            LocationConstraint: context.region as BucketLocationConstraint,
          },
        };
  await s3Client(context).send(new CreateBucketCommand(input));
};

const tryHarden = async (
  op: () => Promise<unknown>,
  what: string
): Promise<void> => {
  try {
    await op();
  } catch {
    warn(`Failed to ${what}`);
  }
};

const hardenBucket = async (
  context: S3Context,
  bucket: string
): Promise<void> => {
  await tryHarden(
    () =>
      s3Client(context).send(
        new PutBucketEncryptionCommand({
          Bucket: bucket,
          ServerSideEncryptionConfiguration: {
            Rules: [
              {
                ApplyServerSideEncryptionByDefault: { SSEAlgorithm: "AES256" },
                BucketKeyEnabled: true,
              },
            ],
          },
        })
      ),
    `enable encryption on '${bucket}'`
  );
  await tryHarden(
    () =>
      s3Client(context).send(
        new PutPublicAccessBlockCommand({
          Bucket: bucket,
          PublicAccessBlockConfiguration: {
            BlockPublicAcls: true,
            IgnorePublicAcls: true,
            BlockPublicPolicy: true,
            RestrictPublicBuckets: true,
          },
        })
      ),
    `block public access on '${bucket}'`
  );
};

/**
 * Ensure an encrypted, public-access-blocked bucket exists. Creates it (region
 * aware) and applies AES256 encryption + public access block if absent; a no-op
 * if it already exists. Hardening failures warn rather than throw, matching the
 * bash helper.
 * @param context - AWS region/profile context.
 * @param bucket - The bucket name.
 * @returns True if the bucket was created, false if it already existed.
 */
export const ensureEncryptedBucket = async (
  context: S3Context,
  bucket: string
): Promise<boolean> => {
  if (await bucketExists(context, bucket)) {
    return false;
  }
  await createBucket(context, bucket);
  await hardenBucket(context, bucket);
  return true;
};

/**
 * Attach a bucket policy document.
 * @param context - AWS region/profile context.
 * @param bucket - The bucket name.
 * @param policy - The policy document as a JSON string.
 */
export const putBucketPolicy = async (
  context: S3Context,
  bucket: string,
  policy: string
): Promise<void> => {
  await s3Client(context).send(
    new PutBucketPolicyCommand({ Bucket: bucket, Policy: policy })
  );
};
