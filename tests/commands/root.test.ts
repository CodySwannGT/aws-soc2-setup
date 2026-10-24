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
  handleDeleteKeys,
  handleRemoveAccess,
} from "../../src/commands/root.js";
import type { GlobalOptions } from "../../src/lib/config.js";
import { CliError } from "../../src/lib/errors.js";
import { buildProgram } from "../../src/program.js";

const iamMock = mockClient(IAMClient);
const orgMock = mockClient(OrganizationsClient);
const stsMock = mockClient(STSClient);

const globals = (over: Partial<GlobalOptions> = {}): GlobalOptions => ({
  region: "us-east-1",
  dryRun: false,
  yes: false,
  ...over,
});

describe("handleDeleteKeys", () => {
  beforeEach(() => {
    iamMock.reset();
    vi.spyOn(process.stdout, "write").mockReturnValue(true);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("refuses without --yes", async () => {
    iamMock
      .on(ListAccessKeysCommand)
      .resolves({ AccessKeyMetadata: [{ AccessKeyId: "AKIA1" }] });
    await expect(handleDeleteKeys(globals())).rejects.toBeInstanceOf(CliError);
    expect(iamMock.commandCalls(DeleteAccessKeyCommand)).toHaveLength(0);
  });

  it("lists but does not delete under --dry-run", async () => {
    iamMock
      .on(ListAccessKeysCommand)
      .resolves({ AccessKeyMetadata: [{ AccessKeyId: "AKIA1" }] });
    await handleDeleteKeys(globals({ dryRun: true }));
    expect(iamMock.commandCalls(DeleteAccessKeyCommand)).toHaveLength(0);
  });

  it("deletes keys with --yes", async () => {
    iamMock
      .on(ListAccessKeysCommand)
      .resolves({ AccessKeyMetadata: [{ AccessKeyId: "AKIA1" }] });
    iamMock.on(DeleteAccessKeyCommand).resolves({});
    await handleDeleteKeys(globals({ yes: true }));
    expect(iamMock.commandCalls(DeleteAccessKeyCommand)).toHaveLength(1);
  });
});

describe("handleRemoveAccess", () => {
  beforeEach(() => {
    iamMock.reset();
    orgMock.reset();
    stsMock.reset();
    vi.spyOn(process.stdout, "write").mockReturnValue(true);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("refuses without --yes", async () => {
    await expect(handleRemoveAccess(globals())).rejects.toBeInstanceOf(
      CliError
    );
  });

  it("previews under --dry-run without org calls", async () => {
    await handleRemoveAccess(globals({ dryRun: true }));
    expect(orgMock.commandCalls(ListAccountsCommand)).toHaveLength(0);
  });

  it("removes root credentials from member accounts with --yes", async () => {
    orgMock.on(EnableAWSServiceAccessCommand).resolves({});
    iamMock
      .on(EnableOrganizationsRootCredentialsManagementCommand)
      .resolves({});
    iamMock.on(EnableOrganizationsRootSessionsCommand).resolves({});
    orgMock
      .on(DescribeOrganizationCommand)
      .resolves({ Organization: { MasterAccountId: "111111111111" } });
    orgMock.on(ListAccountsCommand).resolves({
      Accounts: [{ Id: "222222222222", Name: "Member", Status: "ACTIVE" }],
    });
    stsMock.on(AssumeRootCommand).resolves({
      Credentials: {
        AccessKeyId: "ASIA1",
        SecretAccessKey: "secret",
        SessionToken: "token",
        Expiration: undefined,
      },
    });
    iamMock.on(ListAccessKeysCommand).resolves({ AccessKeyMetadata: [] });
    iamMock.on(DeleteLoginProfileCommand).resolves({});
    iamMock.on(ListSigningCertificatesCommand).resolves({ Certificates: [] });
    iamMock.on(ListMFADevicesCommand).resolves({ MFADevices: [] });

    await handleRemoveAccess(globals({ yes: true }));

    expect(stsMock.commandCalls(AssumeRootCommand)).toHaveLength(1);
  });

  it("reports SCP-restricted root concisely instead of raw AccessDenied text", async () => {
    const writes: string[] = [];
    vi.spyOn(process.stdout, "write").mockImplementation(chunk => {
      writes.push(String(chunk));
      return true;
    });
    orgMock.on(EnableAWSServiceAccessCommand).resolves({});
    iamMock.on(ListOrganizationsFeaturesCommand).resolves({
      EnabledFeatures: ["RootCredentialsManagement", "RootSessions"],
    });
    orgMock
      .on(DescribeOrganizationCommand)
      .resolves({ Organization: { MasterAccountId: "111111111111" } });
    orgMock.on(ListAccountsCommand).resolves({
      Accounts: [{ Id: "222222222222", Name: "Member", Status: "ACTIVE" }],
    });
    stsMock.on(AssumeRootCommand).resolves({
      Credentials: {
        AccessKeyId: "ASIA1",
        SecretAccessKey: "secret",
        SessionToken: "token",
        Expiration: undefined,
      },
    });
    const deny = new Error(
      "User: arn:aws:sts::222222222222:root is not authorized to perform: iam:ListAccessKeys with an explicit deny in a service control policy: arn:aws:organizations::111111111111:policy/o-abc/service_control_policy/p-ctrestrict"
    );
    iamMock.on(ListAccessKeysCommand).rejects(deny);
    iamMock.on(DeleteLoginProfileCommand).rejects(deny);
    iamMock.on(ListSigningCertificatesCommand).rejects(deny);
    iamMock.on(ListMFADevicesCommand).rejects(deny);

    await handleRemoveAccess(globals({ yes: true }));

    const output = writes.join("");
    expect(output).toContain(
      "Centralized root credentials management: enabled"
    );
    expect(output).toContain("Organizations root sessions: enabled");
    expect(output).toContain(
      "Member (222222222222): root already restricted by SCP p-ctrestrict"
    );
    expect(output).not.toContain("is not authorized to perform");
    expect(output).not.toContain("Partial removal");
  });
});

describe("registerRoot", () => {
  it("registers the root command group", () => {
    const root = buildProgram().commands.find(
      command => command.name() === "root"
    );
    const subcommands = (root?.commands ?? []).map(command => command.name());
    expect(subcommands).toEqual(
      expect.arrayContaining(["delete-keys", "remove-access"])
    );
  });
});
