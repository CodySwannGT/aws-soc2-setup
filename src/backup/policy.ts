import type {
  CreateBackupPlanCommandInput,
  CreateBackupSelectionCommandInput,
} from "@aws-sdk/client-backup";

import type { KeyPolicy } from "../kms/policy.js";

export { isValidAccountId } from "../lib/validate.js";

/** Default backup vault name when one is not supplied. */
export const DEFAULT_VAULT_NAME = "soc2-backup-vault";
/** Name of the managed SOC 2 backup plan. */
export const SOC2_PLAN_NAME = "SOC2-Backup-Plan";
/** Alias attached to a freshly created backup KMS key. */
export const BACKUP_KEY_ALIAS = "alias/aws-backup-soc2";

const BACKUP_SERVICE_ACTIONS = [
  "kms:Encrypt",
  "kms:Decrypt",
  "kms:ReEncrypt*",
  "kms:GenerateDataKey*",
  "kms:DescribeKey",
];

/**
 * Build the KMS key policy for a backup encryption key: root account admin, use
 * by the AWS Backup service, and shared access to the central backup account.
 * @param accountId - The account that owns the key.
 * @param centralAccount - The central backup account granted use of the key.
 * @returns The key policy document.
 */
export const buildBackupKeyPolicy = (
  accountId: string,
  centralAccount: string
): KeyPolicy => ({
  Version: "2012-10-17",
  Id: "backup-key-policy",
  Statement: [
    {
      Sid: "Enable IAM User Permissions",
      Effect: "Allow",
      Principal: { AWS: `arn:aws:iam::${accountId}:root` },
      Action: "kms:*",
      Resource: "*",
    },
    {
      Sid: "Allow use of the key for AWS Backup",
      Effect: "Allow",
      Principal: { Service: "backup.amazonaws.com" },
      Action: [...BACKUP_SERVICE_ACTIONS],
      Resource: "*",
    },
    {
      Sid: "Allow access to central backup account",
      Effect: "Allow",
      Principal: { AWS: `arn:aws:iam::${centralAccount}:root` },
      Action: [...BACKUP_SERVICE_ACTIONS],
      Resource: "*",
    },
  ],
});

/**
 * Build the SOC 2 backup plan input: daily and weekly rules targeting the given
 * vault with compliant lifecycle and tagging.
 * @param vaultName - The backup vault the rules target.
 * @returns The create-backup-plan command input.
 */
export const buildBackupPlanInput = (
  vaultName: string
): CreateBackupPlanCommandInput => ({
  BackupPlan: {
    BackupPlanName: SOC2_PLAN_NAME,
    Rules: [
      {
        RuleName: "DailyBackups",
        TargetBackupVaultName: vaultName,
        ScheduleExpression: "cron(0 5 ? * * *)",
        StartWindowMinutes: 60,
        CompletionWindowMinutes: 180,
        Lifecycle: { MoveToColdStorageAfterDays: 30, DeleteAfterDays: 365 },
        RecoveryPointTags: { Compliance: "SOC2" },
      },
      {
        RuleName: "WeeklyBackups",
        TargetBackupVaultName: vaultName,
        ScheduleExpression: "cron(0 5 ? * 1 *)",
        StartWindowMinutes: 60,
        CompletionWindowMinutes: 360,
        Lifecycle: { MoveToColdStorageAfterDays: 90, DeleteAfterDays: 730 },
        RecoveryPointTags: { Compliance: "SOC2" },
      },
    ],
  },
});

/**
 * Build the backup resource-selection input: selects resources tagged
 * `Backup=true` via the default AWS Backup service role.
 * @param backupPlanId - The plan the selection attaches to.
 * @param accountId - The account whose service role is referenced.
 * @returns The create-backup-selection command input.
 */
export const buildBackupSelectionInput = (
  backupPlanId: string,
  accountId: string
): CreateBackupSelectionCommandInput => ({
  BackupPlanId: backupPlanId,
  BackupSelection: {
    SelectionName: "SOC2-Resources",
    IamRoleArn: `arn:aws:iam::${accountId}:role/service-role/AWSBackupDefaultServiceRole`,
    Resources: ["*"],
    ListOfTags: [
      {
        ConditionType: "STRINGEQUALS",
        ConditionKey: "Backup",
        ConditionValue: "true",
      },
    ],
  },
});
