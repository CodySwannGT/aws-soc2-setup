import {
  DeleteAccessKeyCommand,
  DeleteLoginProfileCommand,
  EnableOrganizationsRootCredentialsManagementCommand,
  EnableOrganizationsRootSessionsCommand,
  IAMClient,
  ListAccessKeysCommand,
  ListMFADevicesCommand,
  ListOrganizationsFeaturesCommand,
  ListSigningCertificatesCommand,
} from "@aws-sdk/client-iam";
import {
  DescribeOrganizationCommand,
  EnableAWSServiceAccessCommand,
  ListAccountsCommand,
  OrganizationsClient,
} from "@aws-sdk/client-organizations";
import { AssumeRootCommand, STSClient } from "@aws-sdk/client-sts";
import { mockClient } from "aws-sdk-client-mock";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  listMemberAccounts,
  removeRootCredentials,
} from "../../src/root/root-access.js";
import { enableRootManagement } from "../../src/root/root-features.js";

const iamMock = mockClient(IAMClient);
const orgMock = mockClient(OrganizationsClient);
const stsMock = mockClient(STSClient);

const CTX = { region: "us-east-1" };
const MANAGEMENT = "111111111111";
const MEMBER = "222222222222";

describe("root/root-access", () => {
  beforeEach(() => {
    iamMock.reset();
    orgMock.reset();
    stsMock.reset();
    vi.spyOn(process.stdout, "write").mockReturnValue(true);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("enableRootManagement enables missing features and reports them", async () => {
    orgMock
      .on(EnableAWSServiceAccessCommand)
      .rejects(new Error("already enabled"));
    iamMock.on(ListOrganizationsFeaturesCommand).resolves({
      EnabledFeatures: [],
    });
    iamMock
      .on(EnableOrganizationsRootCredentialsManagementCommand)
      .resolves({});
    iamMock.on(EnableOrganizationsRootSessionsCommand).resolves({});
    await expect(enableRootManagement(CTX)).resolves.toEqual({
      RootCredentialsManagement: { enabled: true },
      RootSessions: { enabled: true },
    });
  });

  it("enableRootManagement skips features that are already enabled", async () => {
    orgMock.on(EnableAWSServiceAccessCommand).resolves({});
    iamMock.on(ListOrganizationsFeaturesCommand).resolves({
      EnabledFeatures: ["RootCredentialsManagement", "RootSessions"],
    });
    await expect(enableRootManagement(CTX)).resolves.toEqual({
      RootCredentialsManagement: { enabled: true },
      RootSessions: { enabled: true },
    });
    expect(
      iamMock.commandCalls(EnableOrganizationsRootCredentialsManagementCommand)
    ).toHaveLength(0);
    expect(
      iamMock.commandCalls(EnableOrganizationsRootSessionsCommand)
    ).toHaveLength(0);
  });

  it("enableRootManagement reports why a feature could not be enabled", async () => {
    orgMock.on(EnableAWSServiceAccessCommand).resolves({});
    iamMock.on(ListOrganizationsFeaturesCommand).resolves({
      EnabledFeatures: ["RootCredentialsManagement"],
    });
    iamMock
      .on(EnableOrganizationsRootSessionsCommand)
      .rejects(new Error("not authorized"));
    await expect(enableRootManagement(CTX)).resolves.toEqual({
      RootCredentialsManagement: { enabled: true },
      RootSessions: { enabled: false, reason: "not authorized" },
    });
  });

  it("removeRootCredentials classifies explicit SCP denies instead of failing", async () => {
    stsMock.on(AssumeRootCommand).resolves({
      Credentials: {
        AccessKeyId: "ASIA1",
        SecretAccessKey: "secret",
        SessionToken: "token",
        Expiration: undefined,
      },
    });
    const scpDeny = (action: string): Error =>
      new Error(
        `User: arn:aws:sts::${MEMBER}:root is not authorized to perform: ${action} on resource: arn:aws:iam::${MEMBER}:root with an explicit deny in a service control policy: arn:aws:organizations::${MANAGEMENT}:policy/o-abc123/service_control_policy/p-ctrestrict`
      );
    iamMock
      .on(DeleteLoginProfileCommand)
      .rejects(scpDeny("iam:DeleteLoginProfile"));
    iamMock.on(ListAccessKeysCommand).rejects(scpDeny("iam:ListAccessKeys"));
    iamMock
      .on(ListSigningCertificatesCommand)
      .rejects(scpDeny("iam:ListSigningCertificates"));
    iamMock.on(ListMFADevicesCommand).rejects(scpDeny("iam:ListMFADevices"));

    const result = await removeRootCredentials(CTX, MEMBER);

    expect(result).toEqual({
      cleared: [],
      failures: [],
      blockedBy: ["p-ctrestrict"],
    });
  });

  it("listMemberAccounts excludes management and inactive accounts", async () => {
    orgMock
      .on(DescribeOrganizationCommand)
      .resolves({ Organization: { MasterAccountId: MANAGEMENT } });
    orgMock.on(ListAccountsCommand).resolves({
      Accounts: [
        { Id: MANAGEMENT, Name: "Mgmt", Status: "ACTIVE" },
        { Id: MEMBER, Name: "Member", Status: "ACTIVE" },
        { Id: "333333333333", Name: "Closed", Status: "SUSPENDED" },
      ],
    });
    await expect(listMemberAccounts(CTX)).resolves.toEqual([
      { id: MEMBER, name: "Member" },
    ]);
  });

  it("removeRootCredentials assumes root and deletes access keys", async () => {
    stsMock.on(AssumeRootCommand).resolves({
      Credentials: {
        AccessKeyId: "ASIA1",
        SecretAccessKey: "secret",
        SessionToken: "token",
        Expiration: undefined,
      },
    });
    iamMock
      .on(ListAccessKeysCommand)
      .resolves({ AccessKeyMetadata: [{ AccessKeyId: "AKIA1" }] });
    iamMock.on(DeleteAccessKeyCommand).resolves({});
    iamMock.on(DeleteLoginProfileCommand).resolves({});
    iamMock.on(ListSigningCertificatesCommand).resolves({ Certificates: [] });
    iamMock.on(ListMFADevicesCommand).resolves({ MFADevices: [] });

    const result = await removeRootCredentials(CTX, MEMBER);

    expect(result?.cleared).toContain("access key AKIA1");
    expect(result?.cleared).toContain("console password");
  });

  it("removeRootCredentials records SCP denials on list calls without throwing", async () => {
    stsMock.on(AssumeRootCommand).resolves({
      Credentials: {
        AccessKeyId: "ASIA1",
        SecretAccessKey: "secret",
        SessionToken: "token",
        Expiration: undefined,
      },
    });
    iamMock.on(DeleteLoginProfileCommand).resolves({});
    iamMock.on(ListAccessKeysCommand).resolves({ AccessKeyMetadata: [] });
    iamMock
      .on(ListSigningCertificatesCommand)
      .rejects(new Error("explicit deny"));
    iamMock.on(ListMFADevicesCommand).rejects(new Error("explicit deny"));

    const result = await removeRootCredentials(CTX, MEMBER);

    expect(result?.cleared).toContain("console password");
    expect(
      result?.failures.some(f => f.includes("list signing certificates"))
    ).toBe(true);
    expect(result?.failures.some(f => f.includes("list MFA devices"))).toBe(
      true
    );
  });

  it("removeRootCredentials returns undefined when assume-root fails", async () => {
    stsMock.on(AssumeRootCommand).rejects(new Error("denied"));
    await expect(removeRootCredentials(CTX, MEMBER)).resolves.toBeUndefined();
  });
});
