import {
  DeactivateMFADeviceCommand,
  DeleteAccessKeyCommand,
  DeleteLoginProfileCommand,
  DeleteSigningCertificateCommand,
  DeleteVirtualMFADeviceCommand,
  IAMClient,
  ListAccessKeysCommand,
  ListMFADevicesCommand,
  ListSigningCertificatesCommand,
} from "@aws-sdk/client-iam";
import {
  DescribeOrganizationCommand,
  ListAccountsCommand,
  OrganizationsClient,
} from "@aws-sdk/client-organizations";
import { AssumeRootCommand, STSClient } from "@aws-sdk/client-sts";

import { buildClientConfig } from "../lib/aws.js";
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

const stsClient = (context: RootContext): STSClient =>
  new STSClient(buildClientConfig(context));

const errorMessage = (error: unknown): string =>
  error instanceof Error ? error.message : String(error);

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

/**
 * What was cleared, what failed, and which SCPs explicitly denied the root
 * session when removing an account's root credentials.
 */
export interface RootRemovalResult {
  cleared: string[];
  failures: string[];
  blockedBy: string[];
}

const EMPTY_RESULT: RootRemovalResult = {
  cleared: [],
  failures: [],
  blockedBy: [],
};

const SCP_DENY = /explicit deny in a service control policy(?::\s*(\S+))?/i;

/**
 * Extract the denying SCP id (`p-...`) from an AccessDenied message, e.g. the
 * Control Tower AWS-GR_RESTRICT_ROOT_USER guardrail, which denies even
 * AssumeRoot sessions.
 * @param error - The caught error.
 * @returns The policy id, "an unnamed SCP", or undefined if not an SCP deny.
 */
const scpDenyPolicy = (error: unknown): string | undefined => {
  const match = SCP_DENY.exec(errorMessage(error));
  if (!match) {
    return undefined;
  }
  return match[1]?.split("/").at(-1) ?? "an unnamed SCP";
};

const failed = (label: string, error: unknown): RootRemovalResult => {
  const policy = scpDenyPolicy(error);
  if (policy) {
    return { ...EMPTY_RESULT, blockedBy: [policy] };
  }
  return { ...EMPTY_RESULT, failures: [`${label}: ${errorMessage(error)}`] };
};

const isMissingEntity = (error: unknown): boolean =>
  /NoSuchEntity|cannot be found|does not exist/i.test(errorMessage(error));

const merge = (
  a: RootRemovalResult,
  b: RootRemovalResult
): RootRemovalResult => ({
  cleared: [...a.cleared, ...b.cleared],
  failures: [...a.failures, ...b.failures],
  blockedBy: [...new Set([...a.blockedBy, ...b.blockedBy])],
});

const tryClear = async (
  op: () => Promise<unknown>,
  label: string
): Promise<RootRemovalResult> => {
  try {
    await op();
    return { ...EMPTY_RESULT, cleared: [label] };
  } catch (error) {
    if (isMissingEntity(error)) {
      return EMPTY_RESULT;
    }
    return failed(label, error);
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

const listOrFail = async <T>(
  op: () => Promise<T>,
  label: string
): Promise<{ value?: T; failure?: RootRemovalResult }> => {
  try {
    return { value: await op() };
  } catch (error) {
    return { failure: failed(label, error) };
  }
};

const clearAccessKeys = async (
  client: IAMClient
): Promise<RootRemovalResult> => {
  const listed = await listOrFail(
    () => client.send(new ListAccessKeysCommand({})),
    "list access keys"
  );
  if (listed.failure || !listed.value) {
    return listed.failure ?? EMPTY_RESULT;
  }
  const ids = (listed.value.AccessKeyMetadata ?? [])
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
  const listed = await listOrFail(
    () => client.send(new ListSigningCertificatesCommand({})),
    "list signing certificates"
  );
  if (listed.failure || !listed.value) {
    return listed.failure ?? EMPTY_RESULT;
  }
  const ids = (listed.value.Certificates ?? [])
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
  const listed = await listOrFail(
    () => client.send(new ListMFADevicesCommand({})),
    "list MFA devices"
  );
  if (listed.failure || !listed.value) {
    return listed.failure ?? EMPTY_RESULT;
  }
  const serials = (listed.value.MFADevices ?? [])
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
