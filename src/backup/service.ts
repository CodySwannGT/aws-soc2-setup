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

import { buildClientConfig } from "../lib/aws.js";
import type { GlobalOptions } from "../lib/config.js";
import { CliError } from "../lib/errors.js";

import {
  SOC2_PLAN_NAME,
  buildBackupPlanInput,
  buildBackupSelectionInput,
} from "./policy.js";

/** AWS context (region + optional profile) every backup call needs. */
export type BackupContext = Pick<GlobalOptions, "region" | "profile">;

const BACKUP_SERVICE_PRINCIPAL = "backup.amazonaws.com";

const backupClient = (context: BackupContext): BackupClient =>
  new BackupClient(buildClientConfig(context));

const tryCreateVault = async (
  context: BackupContext,
  vaultName: string,
  kmsKeyArn: string
): Promise<string | undefined> => {
  try {
    const result = await backupClient(context).send(
      new CreateBackupVaultCommand({
        BackupVaultName: vaultName,
        EncryptionKeyArn: kmsKeyArn,
      })
    );
    return result.BackupVaultArn;
  } catch {
    return undefined;
  }
};

/**
 * Create the backup vault, or return the ARN of the existing one with that name.
 * @param context - AWS region/profile context.
 * @param vaultName - The vault name.
 * @param kmsKeyArn - The KMS key ARN used to encrypt the vault.
 * @returns The vault ARN.
 * @throws {CliError} If the vault can neither be created nor found.
 */
export const ensureBackupVault = async (
  context: BackupContext,
  vaultName: string,
  kmsKeyArn: string
): Promise<string> => {
  const created = await tryCreateVault(context, vaultName, kmsKeyArn);
  if (created) {
    return created;
  }
  const list = await backupClient(context).send(
    new ListBackupVaultsCommand({})
  );
  const existing = (list.BackupVaultList ?? []).find(
    vault => vault.BackupVaultName === vaultName
  );
  if (!existing?.BackupVaultArn) {
    throw new CliError(`Could not find or create backup vault '${vaultName}'.`);
  }
  return existing.BackupVaultArn;
};

const findPlanByName = async (
  context: BackupContext
): Promise<string | undefined> => {
  const list = await backupClient(context).send(new ListBackupPlansCommand({}));
  return (list.BackupPlansList ?? []).find(
    plan => plan.BackupPlanName?.toLowerCase() === SOC2_PLAN_NAME.toLowerCase()
  )?.BackupPlanId;
};

const tryCreatePlan = async (
  context: BackupContext,
  vaultName: string
): Promise<string | undefined> => {
  try {
    const result = await backupClient(context).send(
      new CreateBackupPlanCommand(buildBackupPlanInput(vaultName))
    );
    return result.BackupPlanId;
  } catch {
    return undefined;
  }
};

const findPlanByVault = async (
  context: BackupContext,
  vaultName: string
): Promise<string | undefined> => {
  const list = await backupClient(context).send(new ListBackupPlansCommand({}));
  for (const plan of list.BackupPlansList ?? []) {
    if (!plan.BackupPlanId) {
      continue;
    }
    const details = await backupClient(context).send(
      new GetBackupPlanCommand({ BackupPlanId: plan.BackupPlanId })
    );
    const targetsVault = (details.BackupPlan?.Rules ?? []).some(
      rule => rule.TargetBackupVaultName === vaultName
    );
    if (targetsVault) {
      return plan.BackupPlanId;
    }
  }
  return undefined;
};

/**
 * Ensure the SOC 2 backup plan exists, returning its id. Looks up by name, then
 * tries to create, then (on an already-exists race) matches by target vault.
 * @param context - AWS region/profile context.
 * @param vaultName - The vault the plan targets.
 * @returns The backup plan id.
 * @throws {CliError} If an existing plan cannot be identified.
 */
export const ensureBackupPlan = async (
  context: BackupContext,
  vaultName: string
): Promise<string> => {
  const byName = await findPlanByName(context);
  if (byName) {
    return byName;
  }
  const created = await tryCreatePlan(context, vaultName);
  if (created) {
    return created;
  }
  const byVault = await findPlanByVault(context, vaultName);
  if (!byVault) {
    throw new CliError("Could not identify the existing backup plan.");
  }
  return byVault;
};

/**
 * Create a resource selection (resources tagged `Backup=true`) for a plan.
 * @param context - AWS region/profile context.
 * @param backupPlanId - The plan to attach the selection to.
 * @param accountId - The account whose default backup service role is used.
 * @returns The selection id.
 * @throws {CliError} If the selection cannot be created.
 */
export const createBackupSelection = async (
  context: BackupContext,
  backupPlanId: string,
  accountId: string
): Promise<string> => {
  const result = await backupClient(context).send(
    new CreateBackupSelectionCommand(
      buildBackupSelectionInput(backupPlanId, accountId)
    )
  );
  if (!result.SelectionId) {
    throw new CliError(
      "Failed to create resource selection. Ensure AWSBackupDefaultServiceRole exists."
    );
  }
  return result.SelectionId;
};

/**
 * Register the central account as a delegated administrator for AWS Backup.
 * Returns false rather than throwing when the call is rejected (expected unless
 * run from the Organizations management account).
 * @param context - AWS region/profile context.
 * @param centralAccount - The central backup account id.
 * @returns True if registration succeeded.
 */
export const registerBackupAdministrator = async (
  context: BackupContext,
  centralAccount: string
): Promise<boolean> => {
  try {
    await new OrganizationsClient(buildClientConfig(context)).send(
      new RegisterDelegatedAdministratorCommand({
        ServicePrincipal: BACKUP_SERVICE_PRINCIPAL,
        AccountId: centralAccount,
      })
    );
    return true;
  } catch {
    return false;
  }
};
