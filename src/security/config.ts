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

import { buildClientConfig } from "../lib/aws.js";
import type { GlobalOptions } from "../lib/config.js";
import { info, success, warn } from "../lib/logger.js";
import {
  ensureEncryptedBucket,
  putBucketPolicy,
  type S3Context,
} from "../lib/s3.js";

/** AWS context for security operations. */
export type SecurityContext = Pick<GlobalOptions, "region" | "profile">;

const CONFIG_ROLE_NAME = "AWSConfigRole";
const CONFIG_ROLE_POLICY_ARN =
  "arn:aws:iam::aws:policy/service-role/AWS_ConfigRole";
const CONFIG_PREFIX = "config";
const CONFIG_RECORDER_NAME = "default";
const CONFIG_SERVICE_PRINCIPAL = "config.amazonaws.com";
const POLICY_VERSION = "2012-10-17";

const CONFIG_TRUST_POLICY = JSON.stringify({
  Version: POLICY_VERSION,
  Statement: [
    {
      Effect: "Allow",
      Principal: { Service: CONFIG_SERVICE_PRINCIPAL },
      Action: "sts:AssumeRole",
    },
  ],
});

/**
 * Build the S3 bucket policy allowing AWS Config to check the bucket ACL and
 * deliver configuration snapshots.
 * @param bucket - The config delivery bucket name.
 * @param accountId - The account that owns the config data.
 * @returns The bucket policy document as a JSON string.
 */
export const buildConfigBucketPolicy = (
  bucket: string,
  accountId: string
): string =>
  JSON.stringify({
    Version: POLICY_VERSION,
    Statement: [
      {
        Sid: "AWSConfigBucketPermissionsCheck",
        Effect: "Allow",
        Principal: { Service: CONFIG_SERVICE_PRINCIPAL },
        Action: "s3:GetBucketAcl",
        Resource: `arn:aws:s3:::${bucket}`,
      },
      {
        Sid: "AWSConfigBucketDelivery",
        Effect: "Allow",
        Principal: { Service: CONFIG_SERVICE_PRINCIPAL },
        Action: "s3:PutObject",
        Resource: `arn:aws:s3:::${bucket}/${CONFIG_PREFIX}/AWSLogs/${accountId}/Config/*`,
        Condition: {
          StringEquals: { "s3:x-amz-acl": "bucket-owner-full-control" },
        },
      },
    ],
  });

const iamClient = (context: SecurityContext): IAMClient =>
  new IAMClient(buildClientConfig(context));

const configClient = (context: SecurityContext): ConfigServiceClient =>
  new ConfigServiceClient(buildClientConfig(context));

const applyConfigBucketPolicy = async (
  context: S3Context,
  bucket: string,
  accountId: string
): Promise<void> => {
  try {
    await putBucketPolicy(
      context,
      bucket,
      buildConfigBucketPolicy(bucket, accountId)
    );
    success("Set bucket policy for AWS Config");
  } catch {
    warn(`Failed to set bucket policy for '${bucket}'`);
  }
};

const ensureConfigBucket = async (
  context: SecurityContext,
  accountId: string
): Promise<string> => {
  const bucket = `config-bucket-${accountId}`;
  const created = await ensureEncryptedBucket(context, bucket);
  await applyConfigBucketPolicy(context, bucket, accountId);
  info(
    created
      ? `Created config bucket ${bucket}`
      : `Using config bucket ${bucket}`
  );
  return bucket;
};

const getConfigRoleArn = async (
  context: SecurityContext
): Promise<string | undefined> => {
  try {
    const result = await iamClient(context).send(
      new GetRoleCommand({ RoleName: CONFIG_ROLE_NAME })
    );
    return result.Role?.Arn;
  } catch {
    return undefined;
  }
};

const createConfigRole = async (context: SecurityContext): Promise<string> => {
  const result = await iamClient(context).send(
    new CreateRoleCommand({
      RoleName: CONFIG_ROLE_NAME,
      AssumeRolePolicyDocument: CONFIG_TRUST_POLICY,
    })
  );
  await iamClient(context).send(
    new AttachRolePolicyCommand({
      RoleName: CONFIG_ROLE_NAME,
      PolicyArn: CONFIG_ROLE_POLICY_ARN,
    })
  );
  if (!result.Role?.Arn) {
    return "";
  }
  success(`Created IAM role for AWS Config: ${result.Role.Arn}`);
  return result.Role.Arn;
};

const ensureConfigRole = async (context: SecurityContext): Promise<string> => {
  const existing = await getConfigRoleArn(context);
  if (existing) {
    info(`Using existing IAM role for AWS Config: ${existing}`);
    return existing;
  }
  return createConfigRole(context);
};

const startRecording = async (
  context: SecurityContext,
  bucket: string,
  roleArn: string
): Promise<void> => {
  const client = configClient(context);
  await client.send(
    new PutConfigurationRecorderCommand({
      ConfigurationRecorder: {
        name: CONFIG_RECORDER_NAME,
        roleARN: roleArn,
        recordingGroup: {
          allSupported: true,
          includeGlobalResourceTypes: true,
        },
      },
    })
  );
  await client.send(
    new PutDeliveryChannelCommand({
      DeliveryChannel: {
        name: CONFIG_RECORDER_NAME,
        s3BucketName: bucket,
        s3KeyPrefix: CONFIG_PREFIX,
        configSnapshotDeliveryProperties: { deliveryFrequency: "One_Hour" },
      },
    })
  );
  await client.send(
    new StartConfigurationRecorderCommand({
      ConfigurationRecorderName: CONFIG_RECORDER_NAME,
    })
  );
  success("Started AWS Config recorder");
};

/**
 * Enable AWS Config: create an encrypted delivery bucket and policy, ensure the
 * AWS Config IAM role, then configure and start the recorder and delivery
 * channel.
 * @param context - AWS region/profile context.
 * @param accountId - The account being configured.
 */
export const enableAwsConfig = async (
  context: SecurityContext,
  accountId: string
): Promise<void> => {
  const bucket = await ensureConfigBucket(context, accountId);
  const roleArn = await ensureConfigRole(context);
  if (!roleArn) {
    warn("Could not resolve AWS Config role; skipping recorder setup");
    return;
  }
  await startRecording(context, bucket, roleArn);
};
