import {
  CreateAliasCommand,
  CreateKeyCommand,
  DescribeKeyCommand,
  DisableKeyRotationCommand,
  EnableKeyRotationCommand,
  GetKeyPolicyCommand,
  GetKeyRotationStatusCommand,
  KMSClient,
  ListAliasesCommand,
  PutKeyPolicyCommand,
} from "@aws-sdk/client-kms";

import { buildClientConfig } from "../lib/aws.js";
import type { GlobalOptions } from "../lib/config.js";
import { CliError } from "../lib/errors.js";

import type { KeyPolicy } from "./policy.js";

/** AWS context (region + optional profile) every KMS call needs. */
export type KmsContext = Pick<GlobalOptions, "region" | "profile">;

const POLICY_NAME = "default";

const kmsClient = (context: KmsContext): KMSClient =>
  new KMSClient(buildClientConfig(context));

/** Summary of a KMS key's identity and lifecycle state. */
export interface KeySummary {
  arn: string;
  state: string;
}

/**
 * Describe a KMS key, failing cleanly if it is missing or inaccessible.
 * @param context - AWS region/profile context.
 * @param keyId - The KMS key id or ARN.
 * @returns The key's ARN and state.
 * @throws {CliError} If the key cannot be described.
 */
export const describeKey = async (
  context: KmsContext,
  keyId: string
): Promise<KeySummary> => {
  const result = await kmsClient(context).send(
    new DescribeKeyCommand({ KeyId: keyId })
  );
  if (!result.KeyMetadata?.Arn || !result.KeyMetadata.KeyState) {
    throw new CliError(`KMS key '${keyId}' not found or inaccessible.`);
  }
  return { arn: result.KeyMetadata.Arn, state: result.KeyMetadata.KeyState };
};

/**
 * Fetch and parse the key's default policy document.
 * @param context - AWS region/profile context.
 * @param keyId - The KMS key id or ARN.
 * @returns The parsed key policy.
 * @throws {CliError} If no policy is returned.
 */
export const getKeyPolicy = async (
  context: KmsContext,
  keyId: string
): Promise<KeyPolicy> => {
  const result = await kmsClient(context).send(
    new GetKeyPolicyCommand({ KeyId: keyId, PolicyName: POLICY_NAME })
  );
  if (!result.Policy) {
    throw new CliError(`No policy returned for KMS key '${keyId}'.`);
  }
  return JSON.parse(result.Policy) as KeyPolicy;
};

/**
 * Write a key policy document back to the key's default policy.
 * @param context - AWS region/profile context.
 * @param keyId - The KMS key id or ARN.
 * @param policy - The policy document to persist.
 */
export const putKeyPolicy = async (
  context: KmsContext,
  keyId: string,
  policy: KeyPolicy
): Promise<void> => {
  await kmsClient(context).send(
    new PutKeyPolicyCommand({
      KeyId: keyId,
      PolicyName: POLICY_NAME,
      Policy: JSON.stringify(policy),
    })
  );
};

/**
 * Enable or disable automatic rotation for a key.
 * @param context - AWS region/profile context.
 * @param keyId - The KMS key id or ARN.
 * @param enabled - True to enable rotation, false to disable.
 */
export const setKeyRotation = async (
  context: KmsContext,
  keyId: string,
  enabled: boolean
): Promise<void> => {
  const command = enabled
    ? new EnableKeyRotationCommand({ KeyId: keyId })
    : new DisableKeyRotationCommand({ KeyId: keyId });
  await kmsClient(context).send(command);
};

/**
 * Report whether automatic rotation is currently enabled for a key.
 * @param context - AWS region/profile context.
 * @param keyId - The KMS key id or ARN.
 * @returns True if rotation is enabled.
 */
export const getKeyRotationStatus = async (
  context: KmsContext,
  keyId: string
): Promise<boolean> => {
  const result = await kmsClient(context).send(
    new GetKeyRotationStatusCommand({ KeyId: keyId })
  );
  return result.KeyRotationEnabled ?? false;
};

/**
 * Extract the bare key id from a KMS key ARN (everything after `key/`).
 * @param keyArn - The full KMS key ARN.
 * @returns The key id portion.
 */
export const extractKeyId = (keyArn: string): string =>
  keyArn.replace(/^.*key\//, "");

/** Options for creating a KMS key. */
export interface CreateKeyOptions {
  description: string;
  policy: KeyPolicy;
  multiRegion?: boolean;
}

/**
 * Create a KMS key with the given description and policy.
 * @param context - AWS region/profile context.
 * @param options - Key description, policy, and multi-region flag.
 * @returns The new key's ARN.
 * @throws {CliError} If the key could not be created.
 */
export const createKey = async (
  context: KmsContext,
  options: CreateKeyOptions
): Promise<string> => {
  const result = await kmsClient(context).send(
    new CreateKeyCommand({
      Description: options.description,
      Policy: JSON.stringify(options.policy),
      MultiRegion: options.multiRegion,
    })
  );
  if (!result.KeyMetadata?.Arn) {
    throw new CliError("Failed to create KMS key.");
  }
  return result.KeyMetadata.Arn;
};

/**
 * Report whether a KMS alias already exists.
 * @param context - AWS region/profile context.
 * @param aliasName - The alias name (e.g. `alias/foo`).
 * @returns True if the alias exists.
 */
export const aliasExists = async (
  context: KmsContext,
  aliasName: string
): Promise<boolean> => {
  const result = await kmsClient(context).send(new ListAliasesCommand({}));
  return (result.Aliases ?? []).some(alias => alias.AliasName === aliasName);
};

/**
 * Create a KMS alias if it does not already exist (idempotent).
 * @param context - AWS region/profile context.
 * @param aliasName - The alias name to ensure.
 * @param targetKeyId - The key id the alias should point at.
 */
export const ensureAlias = async (
  context: KmsContext,
  aliasName: string,
  targetKeyId: string
): Promise<void> => {
  if (await aliasExists(context, aliasName)) {
    return;
  }
  await kmsClient(context).send(
    new CreateAliasCommand({ AliasName: aliasName, TargetKeyId: targetKeyId })
  );
};
