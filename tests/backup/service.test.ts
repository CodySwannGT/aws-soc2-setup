import {
  BackupClient,
  CreateBackupPlanCommand,
  CreateBackupSelectionCommand,
  CreateBackupVaultCommand,
  GetBackupPlanCommand,
  ListBackupPlansCommand,
  ListBackupVaultsCommand,
} from "@aws-sdk/client-backup";
import {
  OrganizationsClient,
  RegisterDelegatedAdministratorCommand,
} from "@aws-sdk/client-organizations";
import { mockClient } from "aws-sdk-client-mock";
import { beforeEach, describe, expect, it } from "vitest";

import {
  createBackupSelection,
  ensureBackupPlan,
  ensureBackupVault,
  registerBackupAdministrator,
} from "../../src/backup/service.js";
import { CliError } from "../../src/lib/errors.js";

const backupMock = mockClient(BackupClient);
const orgMock = mockClient(OrganizationsClient);

const CTX = { region: "us-east-1" };
const VAULT = "soc2-backup-vault";
const VAULT_ARN =
  "arn:aws:backup:us-east-1:123456789012:backup-vault:soc2-backup-vault";
const CENTRAL = "444455556666";
const ACCOUNT = "123456789012";
const ALREADY_EXISTS = "AlreadyExistsException";

describe("backup service", () => {
  beforeEach(() => {
    backupMock.reset();
    orgMock.reset();
  });

  describe("ensureBackupVault", () => {
    it("returns the ARN when the vault is created", async () => {
      backupMock
        .on(CreateBackupVaultCommand)
        .resolves({ BackupVaultArn: VAULT_ARN });
      await expect(ensureBackupVault(CTX, VAULT, "arn:key")).resolves.toBe(
        VAULT_ARN
      );
    });

    it("falls back to lookup when creation fails", async () => {
      backupMock
        .on(CreateBackupVaultCommand)
        .rejects(new Error(ALREADY_EXISTS));
      backupMock.on(ListBackupVaultsCommand).resolves({
        BackupVaultList: [
          { BackupVaultName: VAULT, BackupVaultArn: VAULT_ARN },
        ],
      });
      await expect(ensureBackupVault(CTX, VAULT, "arn:key")).resolves.toBe(
        VAULT_ARN
      );
    });

    it("throws when the vault can neither be created nor found", async () => {
      backupMock.on(CreateBackupVaultCommand).rejects(new Error("denied"));
      backupMock.on(ListBackupVaultsCommand).resolves({ BackupVaultList: [] });
      await expect(
        ensureBackupVault(CTX, VAULT, "arn:key")
      ).rejects.toBeInstanceOf(CliError);
    });
  });

  describe("ensureBackupPlan", () => {
    it("returns an existing plan found by name", async () => {
      backupMock.on(ListBackupPlansCommand).resolves({
        BackupPlansList: [
          { BackupPlanName: "SOC2-Backup-Plan", BackupPlanId: "plan-name" },
        ],
      });
      await expect(ensureBackupPlan(CTX, VAULT)).resolves.toBe("plan-name");
    });

    it("creates a plan when none exists by name", async () => {
      backupMock.on(ListBackupPlansCommand).resolves({ BackupPlansList: [] });
      backupMock
        .on(CreateBackupPlanCommand)
        .resolves({ BackupPlanId: "plan-created" });
      await expect(ensureBackupPlan(CTX, VAULT)).resolves.toBe("plan-created");
    });

    it("matches by vault on an already-exists race", async () => {
      backupMock
        .on(ListBackupPlansCommand)
        .resolves({ BackupPlansList: [{ BackupPlanId: "plan-x" }] });
      backupMock.on(CreateBackupPlanCommand).rejects(new Error(ALREADY_EXISTS));
      backupMock.on(GetBackupPlanCommand).resolves({
        BackupPlan: {
          BackupPlanName: "Other",
          Rules: [{ RuleName: "r", TargetBackupVaultName: VAULT }],
        },
      });
      await expect(ensureBackupPlan(CTX, VAULT)).resolves.toBe("plan-x");
    });

    it("throws when an existing plan cannot be identified", async () => {
      backupMock.on(ListBackupPlansCommand).resolves({ BackupPlansList: [] });
      backupMock.on(CreateBackupPlanCommand).rejects(new Error(ALREADY_EXISTS));
      await expect(ensureBackupPlan(CTX, VAULT)).rejects.toBeInstanceOf(
        CliError
      );
    });
  });

  describe("createBackupSelection", () => {
    it("returns the selection id", async () => {
      backupMock
        .on(CreateBackupSelectionCommand)
        .resolves({ SelectionId: "sel-1" });
      await expect(createBackupSelection(CTX, "plan-1", ACCOUNT)).resolves.toBe(
        "sel-1"
      );
    });

    it("throws when no selection id is returned", async () => {
      backupMock.on(CreateBackupSelectionCommand).resolves({});
      await expect(
        createBackupSelection(CTX, "plan-1", ACCOUNT)
      ).rejects.toBeInstanceOf(CliError);
    });
  });

  describe("registerBackupAdministrator", () => {
    it("returns true on success", async () => {
      orgMock.on(RegisterDelegatedAdministratorCommand).resolves({});
      await expect(registerBackupAdministrator(CTX, CENTRAL)).resolves.toBe(
        true
      );
    });

    it("returns false when registration is rejected", async () => {
      orgMock
        .on(RegisterDelegatedAdministratorCommand)
        .rejects(new Error("not management account"));
      await expect(registerBackupAdministrator(CTX, CENTRAL)).resolves.toBe(
        false
      );
    });
  });
});
