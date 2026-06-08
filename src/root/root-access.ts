import {
  DeleteAccessKeyCommand,
  EnableOrganizationsRootCredentialsManagementCommand,
  EnableOrganizationsRootSessionsCommand,
  IAMClient,
  ListAccessKeysCommand,
} from "@aws-sdk/client-iam";
import {
  DescribeOrganizationCommand,
  EnableAWSServiceAccessCommand,
  ListAccountsCommand,
  OrganizationsClient,
} from "@aws-sdk/client-organizations";
import { AssumeRootCommand, STSClient } from "@aws-sdk/client-sts";

import { buildClientConfig } from "../lib/aws.js";
import { warn } from "../lib/logger.js";

import type { RootContext } from "./access-keys.js";

const DELETE_ROOT_POLICY =
  "arn:aws:iam::aws:policy/root-task/IAMDeleteRootUserCredentials";

/** A member account in the organization. */
export interface MemberAccount {
  id: string;
  name: string;
}

const orgClient = (context: RootContext): OrganizationsClient =>
  new OrganizationsClient(buildClientConfig(context));

const iamClient = (context: RootContext): IAMClient =>
  new IAMClient(buildClientConfig(context));

const stsClient = (context: RootContext): STSClient =>
  new STSClient(buildClientConfig(context));

const tryEnable = async (
  op: () => Promise<unknown>,
  label: string
): Promise<void> => {
  try {
    await op();
  } catch {
    warn(`${label} is already enabled or could not be enabled`);
  }
};

/**
 * Enable the three organization-level root-management features (best-effort).
 * @param context - AWS region/profile context.
 */
export const enableRootManagement = async (
  context: RootContext
): Promise<void> => {
  await tryEnable(
    () =>
      orgClient(context).send(
        new EnableAWSServiceAccessCommand({
          ServicePrincipal: "iam.amazonaws.com",
        })
      ),
    "IAM trusted access"
  );
  await tryEnable(
    () =>
      iamClient(context).send(
        new EnableOrganizationsRootCredentialsManagementCommand({})
      ),
    "Root credentials management"
  );
  await tryEnable(
    () =>
      iamClient(context).send(new EnableOrganizationsRootSessionsCommand({})),
    "Organizations root sessions"
  );
};

/**
 * List active member accounts excluding the management account.
 * @param context - AWS region/profile context.
 * @returns The member accounts.
 */
export const listMemberAccounts = async (
  context: RootContext
): Promise<MemberAccount[]> => {
  const org = await orgClient(context).send(
    new DescribeOrganizationCommand({})
  );
  const managementId = org.Organization?.MasterAccountId;
  const accounts = await orgClient(context).send(new ListAccountsCommand({}));
  return (accounts.Accounts ?? [])
    .filter(
      account =>
        account.Status === "ACTIVE" &&
        account.Id !== undefined &&
        account.Id !== managementId
    )
    .map(account => ({ id: account.Id!, name: account.Name ?? account.Id! }));
};

const deleteWithCredentials = async (
  context: RootContext,
  credentials: {
    accessKeyId: string;
    secretAccessKey: string;
    sessionToken: string;
  }
): Promise<boolean> => {
  const client = new IAMClient({
    region: context.region,
    credentials,
  });
  try {
    const keys = await client.send(new ListAccessKeysCommand({}));
    for (const key of keys.AccessKeyMetadata ?? []) {
      if (key.AccessKeyId) {
        await client.send(
          new DeleteAccessKeyCommand({ AccessKeyId: key.AccessKeyId })
        );
      }
    }
    return true;
  } catch {
    return false;
  }
};

/**
 * Remove root credentials from a member account by assuming a scoped root
 * session and deleting the root user's credentials.
 * @param context - AWS region/profile context (management account).
 * @param accountId - The member account to clear.
 * @returns True if root credentials were deleted.
 */
export const removeRootCredentials = async (
  context: RootContext,
  accountId: string
): Promise<boolean> => {
  const session = await assumeRoot(context, accountId);
  if (!session) {
    return false;
  }
  return deleteWithCredentials(context, session);
};

const assumeRoot = async (
  context: RootContext,
  accountId: string
): Promise<
  | { accessKeyId: string; secretAccessKey: string; sessionToken: string }
  | undefined
> => {
  try {
    const result = await stsClient(context).send(
      new AssumeRootCommand({
        TargetPrincipal: accountId,
        TaskPolicyArn: { arn: DELETE_ROOT_POLICY },
      })
    );
    const creds = result.Credentials;
    if (!creds?.AccessKeyId || !creds.SecretAccessKey || !creds.SessionToken) {
      return undefined;
    }
    return {
      accessKeyId: creds.AccessKeyId,
      secretAccessKey: creds.SecretAccessKey,
      sessionToken: creds.SessionToken,
    };
  } catch {
    return undefined;
  }
};
