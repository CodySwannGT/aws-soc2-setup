import {
  DeleteAccessKeyCommand,
  IAMClient,
  ListAccessKeysCommand,
} from "@aws-sdk/client-iam";

import { buildClientConfig } from "../lib/aws.js";
import type { GlobalOptions } from "../lib/config.js";

/** AWS context for root-account operations. */
export type RootContext = Pick<GlobalOptions, "region" | "profile">;

const iamClient = (context: RootContext): IAMClient =>
  new IAMClient(buildClientConfig(context));

/**
 * List the caller's (root user's) access key ids.
 * @param context - AWS region/profile context.
 * @returns The access key ids (empty if none).
 */
export const listRootAccessKeyIds = async (
  context: RootContext
): Promise<string[]> => {
  const result = await iamClient(context).send(new ListAccessKeysCommand({}));
  return (result.AccessKeyMetadata ?? [])
    .map(key => key.AccessKeyId)
    .filter((id): id is string => Boolean(id));
};

/**
 * Delete a root user access key.
 * @param context - AWS region/profile context.
 * @param accessKeyId - The access key id to delete.
 */
export const deleteAccessKey = async (
  context: RootContext,
  accessKeyId: string
): Promise<void> => {
  await iamClient(context).send(
    new DeleteAccessKeyCommand({ AccessKeyId: accessKeyId })
  );
};
