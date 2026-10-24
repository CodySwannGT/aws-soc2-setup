/** SOC 2 type targeted by a control set. */
export type Soc2Type = "type1" | "type2" | "both";
/** Control baseline depth. */
export type ControlBaseline = "minimal" | "recommended" | "comprehensive";

/**
 * Control ids grouped by baseline and SOC 2 type. Each id is one of:
 * - a legacy Control Tower-owned `AWS-GR_*` control (enabled by its regional
 *   Control Tower ARN),
 * - a landing-zone mandatory `AWS-GR_*` control (already enforced; never
 *   enabled — see {@link LANDING_ZONE_MANDATORY_CONTROLS}), or
 * - an AWS Config managed-rule identifier that Control Tower exposes as a
 *   Control Catalog detective control (resolved to its opaque catalog ARN at
 *   run time — see {@link CONFIG_RULE_CONTROLS}).
 */
export const CONTROL_SETS = {
  minimal: {
    type1: [
      "AWS-GR_ROOT_ACCOUNT_MFA_ENABLED",
      "AWS-GR_IAM_USER_MFA_ENABLED",
      "AWS-GR_RESTRICT_ROOT_USER",
      "AWS-GR_ENCRYPTED_VOLUMES",
    ],
    type2: ["AWS-GR_CLOUDTRAIL_ENABLED", "CLOUDWATCH_ALARM_ACTION_CHECK"],
  },
  recommended: {
    type1: [
      "AWS-GR_S3_BUCKET_PUBLIC_READ_PROHIBITED",
      "AWS-GR_S3_BUCKET_PUBLIC_WRITE_PROHIBITED",
      "S3_BUCKET_SERVER_SIDE_ENCRYPTION_ENABLED",
      "AWS-GR_RDS_STORAGE_ENCRYPTED",
      "AWS-GR_RESTRICTED_SSH",
      "AWS-GR_RESTRICTED_COMMON_PORTS",
    ],
    type2: [
      "CLOUD_TRAIL_LOG_FILE_VALIDATION_ENABLED",
      "CLOUD_TRAIL_ENCRYPTION_ENABLED",
      "AWS-GR_CONFIG_ENABLED",
    ],
  },
  comprehensive: {
    type1: [
      "AWS-GR_LAMBDA_FUNCTION_PUBLIC_ACCESS_PROHIBITED",
      "AWS-GR_EBS_OPTIMIZED_INSTANCE",
      "IAM_USER_GROUP_MEMBERSHIP_CHECK",
      "IAM_GROUP_HAS_USERS_CHECK",
      "IAM_POLICY_NO_STATEMENTS_WITH_ADMIN_ACCESS",
    ],
    type2: [
      "VPC_FLOW_LOGS_ENABLED",
      "GUARDDUTY_ENABLED_CENTRALIZED",
      "SECURITYHUB_ENABLED",
    ],
  },
} as const;

/** Human-readable descriptions for each control id. */
export const CONTROL_DESCRIPTIONS: Record<string, string> = {
  "AWS-GR_ROOT_ACCOUNT_MFA_ENABLED": "Ensure Root Account has MFA Enabled",
  "AWS-GR_IAM_USER_MFA_ENABLED": "Ensure IAM Users have MFA Enabled",
  "AWS-GR_RESTRICT_ROOT_USER": "Restrict Root User Access",
  "AWS-GR_ENCRYPTED_VOLUMES": "Ensure EBS Volumes are Encrypted",
  "AWS-GR_CLOUDTRAIL_ENABLED": "Ensure CloudTrail is Enabled",
  CLOUDWATCH_ALARM_ACTION_CHECK: "Ensure CloudWatch Alarms Have Actions",
  "AWS-GR_S3_BUCKET_PUBLIC_READ_PROHIBITED":
    "Prohibit Public Read Access to S3 Buckets",
  "AWS-GR_S3_BUCKET_PUBLIC_WRITE_PROHIBITED":
    "Prohibit Public Write Access to S3 Buckets",
  S3_BUCKET_SERVER_SIDE_ENCRYPTION_ENABLED:
    "Ensure S3 Buckets Have Encryption Enabled",
  "AWS-GR_RDS_STORAGE_ENCRYPTED": "Ensure RDS Storage is Encrypted",
  "AWS-GR_RESTRICTED_SSH": "Restrict SSH Access",
  "AWS-GR_RESTRICTED_COMMON_PORTS": "Restrict Access to Common Ports",
  CLOUD_TRAIL_LOG_FILE_VALIDATION_ENABLED:
    "Enable CloudTrail Log File Validation",
  CLOUD_TRAIL_ENCRYPTION_ENABLED: "Enable CloudTrail Encryption",
  "AWS-GR_CONFIG_ENABLED": "Enable AWS Config",
  "AWS-GR_LAMBDA_FUNCTION_PUBLIC_ACCESS_PROHIBITED":
    "Prohibit Public Access to Lambda Functions",
  "AWS-GR_EBS_OPTIMIZED_INSTANCE": "Use EBS Optimized Instances",
  IAM_USER_GROUP_MEMBERSHIP_CHECK: "Ensure IAM Users are in at Least One Group",
  IAM_GROUP_HAS_USERS_CHECK: "Ensure IAM Groups Have at Least One User",
  IAM_POLICY_NO_STATEMENTS_WITH_ADMIN_ACCESS:
    "Restrict Admin Access in IAM Policies",
  VPC_FLOW_LOGS_ENABLED: "Enable VPC Flow Logs",
  GUARDDUTY_ENABLED_CENTRALIZED: "Enable Centralized GuardDuty",
  SECURITYHUB_ENABLED: "Enable Security Hub",
};

/**
 * Mandatory controls the landing zone applies to every registered OU. The
 * Control Tower API rejects enabling them ("enforced by default and cannot be
 * enabled"), so they are reported as already enforced rather than attempted.
 */
export const LANDING_ZONE_MANDATORY_CONTROLS: ReadonlySet<string> = new Set([
  "AWS-GR_CLOUDTRAIL_ENABLED",
  "AWS-GR_CONFIG_ENABLED",
]);

/**
 * Controls identified by their AWS Config managed-rule id. Control Tower ships
 * these as Control Catalog detective controls with opaque ARNs, so they are
 * looked up by implementation identifier before being enabled.
 */
export const CONFIG_RULE_CONTROLS: ReadonlySet<string> = new Set([
  "CLOUDWATCH_ALARM_ACTION_CHECK",
  "S3_BUCKET_SERVER_SIDE_ENCRYPTION_ENABLED",
  "CLOUD_TRAIL_LOG_FILE_VALIDATION_ENABLED",
  "CLOUD_TRAIL_ENCRYPTION_ENABLED",
  "IAM_USER_GROUP_MEMBERSHIP_CHECK",
  "IAM_GROUP_HAS_USERS_CHECK",
  "IAM_POLICY_NO_STATEMENTS_WITH_ADMIN_ACCESS",
  "VPC_FLOW_LOGS_ENABLED",
  "GUARDDUTY_ENABLED_CENTRALIZED",
  "SECURITYHUB_ENABLED",
]);

/**
 * Controls confirmed to use the regional Control Tower ARN format
 * (`arn:aws:controltower:us-east-1::control/<id>`).
 */
export const CONTROL_TOWER_FORMAT_CONTROLS: ReadonlySet<string> = new Set([
  "AWS-GR_ENCRYPTED_VOLUMES",
  "AWS-GR_IAM_USER_MFA_ENABLED",
  "AWS-GR_RESTRICTED_COMMON_PORTS",
  "AWS-GR_RESTRICTED_SSH",
  "AWS-GR_RESTRICT_ROOT_USER",
  "AWS-GR_ROOT_ACCOUNT_MFA_ENABLED",
]);

/** Controls confirmed to use the Control Catalog ARN format. */
export const CONTROL_CATALOG_FORMAT_CONTROLS: ReadonlySet<string> = new Set([
  "AWS-GR_S3_BUCKET_PUBLIC_READ_PROHIBITED",
  "AWS-GR_S3_BUCKET_PUBLIC_WRITE_PROHIBITED",
]);
