import {
  BackupClient,
  CreateBackupPlanCommand,
  CreateBackupSelectionCommand,
  CreateBackupVaultCommand,
  ListBackupPlansCommand,
} from "@aws-sdk/client-backup";
import {
  CreateAliasCommand,
  CreateKeyCommand,
  KMSClient,
  ListAliasesCommand,
} from "@aws-sdk/client-kms";
import {
  OrganizationsClient,
  RegisterDelegatedAdministratorCommand,
} from "@aws-sdk/client-organizations";
import { GetCallerIdentityCommand, STSClient } from "@aws-sdk/client-sts";
import { mockClient } from "aws-sdk-client-mock";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { handleBackup } from "../../src/commands/backup.js";
import type { GlobalOptions } from "../../src/lib/config.js";
import { CliError } from "../../src/lib/errors.js";
import { buildProgram } from "../../src/program.js";

const stsMock = mockClient(STSClient);
const kmsMock = mockClient(KMSClient);
const backupMock = mockClient(BackupClient);
const orgMock = mockClient(OrganizationsClient);

const ACCOUNT = "123456789012";
const CENTRAL = "444455556666";
const ADMIN = "777788889999";
const VAULT = "soc2-backup-vault";

const globals = (overrides: Partial<GlobalOptions> = {}): GlobalOptions => ({
  region: "us-east-1",
  dryRun: false,
  yes: false,
  ...overrides,
});

const baseOptions = {
  centralAccount: CENTRAL,
  adminAccount: ADMIN,
  vaultName: VAULT,
};

const primeAwsCalls = (): void => {
  stsMock.on(GetCallerIdentityCommand).resolves({
    Account: ACCOUNT,
    Arn: `arn:aws:iam::${ACCOUNT}:user/admin`,
    UserId: "AIDA",
  });
  kmsMock.on(CreateKeyCommand).resolves({
    KeyMetadata: { KeyId: "key-1", Arn: "arn:aws:kms:us-east-1:1:key/key-1" },
  });
  kmsMock.on(ListAliasesCommand).resolves({ Aliases: [] });
  kmsMock.on(CreateAliasCommand).resolves({});
  backupMock
    .on(CreateBackupVaultCommand)
    .resolves({ BackupVaultArn: "arn:vault" });
  backupMock.on(ListBackupPlansCommand).resolves({ BackupPlansList: [] });
  backupMock.on(CreateBackupPlanCommand).resolves({ BackupPlanId: "plan-1" });
  backupMock
    .on(CreateBackupSelectionCommand)
    .resolves({ SelectionId: "sel-1" });
  orgMock.on(RegisterDelegatedAdministratorCommand).resolves({});
};

describe("handleBackup", () => {
  beforeEach(() => {
    stsMock.reset();
    kmsMock.reset();
    backupMock.reset();
    orgMock.reset();
    primeAwsCalls();
    vi.spyOn(process.stdout, "write").mockReturnValue(true);
    vi.spyOn(process.stderr, "write").mockReturnValue(true);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("rejects an invalid central account before any AWS call", async () => {
    await expect(
      handleBackup(globals(), { ...baseOptions, centralAccount: "abc" })
    ).rejects.toBeInstanceOf(CliError);
    expect(stsMock.commandCalls(GetCallerIdentityCommand)).toHaveLength(0);
  });

  it("makes no mutating calls under --dry-run", async () => {
    await handleBackup(globals({ dryRun: true }), { ...baseOptions });
    expect(backupMock.commandCalls(CreateBackupVaultCommand)).toHaveLength(0);
    expect(kmsMock.commandCalls(CreateKeyCommand)).toHaveLength(0);
  });

  it("provisions a KMS key when none is supplied", async () => {
    await handleBackup(globals(), { ...baseOptions });
    expect(kmsMock.commandCalls(CreateKeyCommand)).toHaveLength(1);
  });

  it("uses the supplied KMS key without creating one", async () => {
    await handleBackup(globals(), {
      ...baseOptions,
      kmsKey: "arn:existing-key",
    });
    expect(kmsMock.commandCalls(CreateKeyCommand)).toHaveLength(0);
    expect(backupMock.commandCalls(CreateBackupSelectionCommand)).toHaveLength(
      1
    );
  });

  it("rejects an invalid admin account", async () => {
    await expect(
      handleBackup(globals(), { ...baseOptions, adminAccount: "xyz" })
    ).rejects.toBeInstanceOf(CliError);
  });

  it("warns when delegated-admin registration is rejected", async () => {
    orgMock.reset();
    orgMock
      .on(RegisterDelegatedAdministratorCommand)
      .rejects(new Error("not management account"));
    const out = vi.spyOn(process.stdout, "write").mockReturnValue(true);
    await handleBackup(globals(), { ...baseOptions, kmsKey: "arn:k" });
    const printed = out.mock.calls.map(call => String(call[0])).join("");
    expect(printed).toContain("Could not register delegated administrator");
  });

  it("runs end-to-end via the program", async () => {
    await buildProgram().parseAsync([
      "node",
      "aws-soc2-setup",
      "backup",
      "-c",
      CENTRAL,
      "-a",
      ADMIN,
      "--kms-key",
      "arn:k",
    ]);
    expect(backupMock.commandCalls(CreateBackupSelectionCommand)).toHaveLength(
      1
    );
  });
});

describe("registerBackup", () => {
  it("registers the backup command on the program", () => {
    const names = buildProgram().commands.map(command => command.name());
    expect(names).toContain("backup");
  });
});
