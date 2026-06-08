import {
  ListInstancesCommand,
  SSOAdminClient,
} from "@aws-sdk/client-sso-admin";

import { buildClientConfig } from "../lib/aws.js";
import type { GlobalOptions } from "../lib/config.js";
import { CliError } from "../lib/errors.js";

/** AWS context (region + optional profile) every SSO call needs. */
export type SsoContext = Pick<GlobalOptions, "region" | "profile">;

/** Identifiers for the account's IAM Identity Center instance. */
export interface IdentityCenterInstance {
  instanceArn: string;
  identityStoreId: string;
}

/**
 * Create an SSO Admin client for the given context.
 * @param context - AWS region/profile context.
 * @returns A configured SSO Admin client.
 */
export const ssoAdminClient = (context: SsoContext): SSOAdminClient =>
  new SSOAdminClient(buildClientConfig(context));

/**
 * Resolve the account's IAM Identity Center instance ARN and identity store id.
 * @param context - AWS region/profile context.
 * @returns The instance ARN and identity store id.
 * @throws {CliError} If no enabled Identity Center instance is found.
 */
export const getInstance = async (
  context: SsoContext
): Promise<IdentityCenterInstance> => {
  const result = await ssoAdminClient(context).send(
    new ListInstancesCommand({})
  );
  const instance = result.Instances?.[0];
  if (!instance?.InstanceArn || !instance.IdentityStoreId) {
    throw new CliError(
      "Could not find an IAM Identity Center instance. Make sure it is enabled."
    );
  }
  return {
    instanceArn: instance.InstanceArn,
    identityStoreId: instance.IdentityStoreId,
  };
};
