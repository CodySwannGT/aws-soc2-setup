import { GetCallerIdentityCommand, STSClient } from "@aws-sdk/client-sts";

import { buildClientConfig } from "./aws.js";
import type { GlobalOptions } from "./config.js";
import { CliError } from "./errors.js";

/**
 * The identity of the credentials the CLI is operating as.
 */
export interface CallerIdentity {
  account: string;
  arn: string;
  userId: string;
}

/**
 * Resolve the AWS caller identity for the configured profile/region. This is
 * the TS equivalent of the `aws sts get-caller-identity` preflight every bash
 * script performed to confirm the profile works before acting.
 * @param options - Resolved global options (region and optional profile).
 * @returns The caller's account id, ARN, and user id.
 * @throws {CliError} If AWS returns an incomplete identity.
 */
export const getCallerIdentity = async (
  options: Pick<GlobalOptions, "region" | "profile">
): Promise<CallerIdentity> => {
  const client = new STSClient(buildClientConfig(options));
  const result = await client.send(new GetCallerIdentityCommand({}));

  if (!result.Account || !result.Arn || !result.UserId) {
    throw new CliError("AWS returned an incomplete caller identity.");
  }

  return {
    account: result.Account,
    arn: result.Arn,
    userId: result.UserId,
  };
};
