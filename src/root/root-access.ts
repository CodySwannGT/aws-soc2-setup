import {
  DeactivateMFADeviceCommand,
  DeleteAccessKeyCommand,
  DeleteLoginProfileCommand,
  DeleteSigningCertificateCommand,
  DeleteVirtualMFADeviceCommand,
  EnableOrganizationsRootCredentialsManagementCommand,
  EnableOrganizationsRootSessionsCommand,
  IAMClient,
  ListAccessKeysCommand,
  ListMFADevicesCommand,
  ListSigningCertificatesCommand,
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
import { collectPaged } from "../lib/paginate.js";

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
  const accounts = await collectPaged(async token => {
    const page = await orgClient(context).send(
      new ListAccountsCommand({ NextToken: token })
    );
    return { items: page.Accounts ?? [], next: page.NextToken };
  });
  return accounts
    .filter(
      account =>
        account.Status === "ACTIVE" &&
        account.Id !== undefined &&
        account.Id !== managementId
    )
    .map(account => ({ id: account.Id!, name: account.Name ?? account.Id! }));
};

/** Temporary credentials from an assume-root session. */
interface TempCredentials {
  accessKeyId: string;
  secretAccessKey: string;
  sessionToken: string;
}

/** What was cleared (and what failed) when removing an account's root credentials. */
export interface RootRemovalResult {
  cleared: string[];
  failures: string[];
}

const EMPTY_RESULT: RootRemovalResult = { cleared: [], failures: [] };

const errorMessage = (error: unknown): string =>
  error instanceof Error ? error.message : String(error);

const isMissingEntity = (error: unknown): boolean =>
  /NoSuchEntity|cannot be found|does not exist/i.test(errorMessage(error));

const merge = (
  a: RootRemovalResult,
  b: RootRemovalResult
): RootRemovalResult => ({
  cleared: [...a.cleared, ...b.cleared],
  failures: [...a.failures, ...b.failures],
});

const tryClear = async (
  op: () => Promise<unknown>,
  label: string
): Promise<RootRemovalResult> => {
  try {
    await op();
    return { cleared: [label], failures: [] };
  } catch (error) {
    if (isMissingEntity(error)) {
      return EMPTY_RESULT;
    }
    return { cleared: [], failures: [`${label}: ${errorMessage(error)}`] };
  }
};

const reduceClears = async (
  items: string[],
  handler: (item: string) => Promise<RootRemovalResult>
): Promise<RootRemovalResult> =>
  items.reduce<Promise<RootRemovalResult>>(
    async (accPromise, item) => merge(await accPromise, await handler(item)),
    Promise.resolve(EMPTY_RESULT)
  );

const clearLoginProfile = (client: IAMClient): Promise<RootRemovalResult> =>
  tryClear(
    () => client.send(new DeleteLoginProfileCommand({})),
    "console password"
  );

const clearAccessKeys = async (
  client: IAMClient
): Promise<RootRemovalResult> => {
  const listed = await client.send(new ListAccessKeysCommand({}));
  const ids = (listed.AccessKeyMetadata ?? [])
    .map(key => key.AccessKeyId)
    .filter((id): id is string => Boolean(id));
  return reduceClears(ids, id =>
    tryClear(
      () => client.send(new DeleteAccessKeyCommand({ AccessKeyId: id })),
      `access key ${id}`
    )
  );
};

const clearSigningCertificates = async (
  client: IAMClient
): Promise<RootRemovalResult> => {
  const listed = await client.send(new ListSigningCertificatesCommand({}));
  const ids = (listed.Certificates ?? [])
    .map(cert => cert.CertificateId)
    .filter((id): id is string => Boolean(id));
  return reduceClears(ids, id =>
    tryClear(
      () =>
        client.send(new DeleteSigningCertificateCommand({ CertificateId: id })),
      `signing certificate ${id}`
    )
  );
};

const clearMfaDevice = async (
  client: IAMClient,
  serial: string
): Promise<RootRemovalResult> => {
  const deactivated = await tryClear(
    () => client.send(new DeactivateMFADeviceCommand({ SerialNumber: serial })),
    `MFA device ${serial}`
  );
  if (!serial.startsWith("arn:")) {
    return deactivated;
  }
  return merge(
    deactivated,
    await tryClear(
      () =>
        client.send(
          new DeleteVirtualMFADeviceCommand({ SerialNumber: serial })
        ),
      `virtual MFA ${serial}`
    )
  );
};

const clearMfaDevices = async (
  client: IAMClient
): Promise<RootRemovalResult> => {
  const listed = await client.send(new ListMFADevicesCommand({}));
  const serials = (listed.MFADevices ?? [])
    .map(device => device.SerialNumber)
    .filter((serial): serial is string => Boolean(serial));
  return reduceClears(serials, serial => clearMfaDevice(client, serial));
};

const deleteWithCredentials = async (
  context: RootContext,
  credentials: TempCredentials
): Promise<RootRemovalResult> => {
  const client = new IAMClient({ region: context.region, credentials });
  const results = await Promise.all([
    clearLoginProfile(client),
    clearAccessKeys(client),
    clearSigningCertificates(client),
    clearMfaDevices(client),
  ]);
  return results.reduce(merge, EMPTY_RESULT);
};

/**
 * Remove ALL root credentials (console password, access keys, signing
 * certificates, and MFA devices) from a member account by assuming a scoped
 * root session. Returns undefined if the root session could not be assumed.
 * @param context - AWS region/profile context (management account).
 * @param accountId - The member account to clear.
 * @returns What was cleared and what failed, or undefined if assume-root failed.
 */
export const removeRootCredentials = async (
  context: RootContext,
  accountId: string
): Promise<RootRemovalResult | undefined> => {
  const session = await assumeRoot(context, accountId);
  if (!session) {
    return undefined;
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
