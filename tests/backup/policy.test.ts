import { describe, expect, it } from "vitest";

import {
  SOC2_PLAN_NAME,
  buildBackupKeyPolicy,
  buildBackupPlanInput,
  buildBackupSelectionInput,
  isValidAccountId,
} from "../../src/backup/policy.js";

const ACCOUNT = "123456789012";
const CENTRAL = "444455556666";
const VAULT = "soc2-backup-vault";

describe("isValidAccountId", () => {
  it("accepts a 12-digit id", () => {
    expect(isValidAccountId(ACCOUNT)).toBe(true);
  });

  it("rejects ids that are not exactly 12 digits", () => {
    expect(isValidAccountId("123")).toBe(false);
    expect(isValidAccountId("12345678901a")).toBe(false);
    expect(isValidAccountId("1234567890123")).toBe(false);
  });
});

describe("buildBackupKeyPolicy", () => {
  it("includes root, backup-service, and central-account statements", () => {
    const policy = buildBackupKeyPolicy(ACCOUNT, CENTRAL);
    expect(policy.Statement).toHaveLength(3);
    expect(policy.Statement[0]?.Principal.AWS).toBe(
      `arn:aws:iam::${ACCOUNT}:root`
    );
    expect(policy.Statement[1]?.Principal).toEqual({
      Service: "backup.amazonaws.com",
    });
    expect(policy.Statement[2]?.Principal.AWS).toBe(
      `arn:aws:iam::${CENTRAL}:root`
    );
  });
});

describe("buildBackupPlanInput", () => {
  it("creates daily and weekly rules targeting the vault", () => {
    const input = buildBackupPlanInput(VAULT);
    expect(input.BackupPlan?.BackupPlanName).toBe(SOC2_PLAN_NAME);
    const rules = input.BackupPlan?.Rules ?? [];
    expect(rules).toHaveLength(2);
    expect(rules.every(rule => rule.TargetBackupVaultName === VAULT)).toBe(
      true
    );
  });
});

describe("buildBackupSelectionInput", () => {
  it("references the default service role and the Backup=true tag", () => {
    const input = buildBackupSelectionInput("plan-1", ACCOUNT);
    expect(input.BackupPlanId).toBe("plan-1");
    expect(input.BackupSelection?.IamRoleArn).toContain(ACCOUNT);
    expect(input.BackupSelection?.ListOfTags?.[0]?.ConditionValue).toBe("true");
  });
});
