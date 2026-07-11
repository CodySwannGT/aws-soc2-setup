/** Name of the managed SCP that blocks long-lived IAM credentials. */
export const DENY_IAM_USERS_POLICY_NAME = "DenyLongLivedIamCredentials";

/** Description attached to the SCP in AWS Organizations. */
export const DENY_IAM_USERS_POLICY_DESCRIPTION =
  "Deny creation of IAM users and long-lived credentials; identities belong " +
  "in IAM Identity Center. The management account is exempt from SCPs by " +
  "AWS design — pair with `scp alert-management` for coverage there.";

/**
 * The IAM actions that mint long-lived credentials. Denying these org-wide
 * forces all human and workload access through IAM Identity Center / roles.
 */
export const DENIED_IAM_ACTIONS = [
  "iam:CreateAccessKey",
  "iam:CreateLoginProfile",
  "iam:CreateServiceSpecificCredential",
  "iam:CreateUser",
  "iam:UploadSSHPublicKey",
] as const;

/**
 * The CloudTrail event names matching {@link DENIED_IAM_ACTIONS}, used by the
 * management-account detective rule (event names have no `iam:` prefix).
 */
export const DENIED_IAM_EVENT_NAMES = DENIED_IAM_ACTIONS.map(
  action => action.split(":")[1] ?? action
);

const exemptionCondition = (
  exemptArns: readonly string[]
): Record<string, unknown> =>
  exemptArns.length === 0
    ? {}
    : { Condition: { ArnNotLike: { "aws:PrincipalArn": [...exemptArns] } } };

/**
 * Build the SCP document that denies long-lived IAM credential creation.
 * @param exemptArns - Principal ARN patterns (e.g. a break-glass role path)
 * excluded from the deny; empty for a blanket deny.
 * @returns The policy document as a JSON string, ready for AWS Organizations.
 */
export const buildDenyIamUsersPolicy = (
  exemptArns: readonly string[] = []
): string =>
  JSON.stringify(
    {
      Version: "2012-10-17",
      Statement: [
        {
          Sid: "DenyLongLivedIamCredentials",
          Effect: "Deny",
          Action: [...DENIED_IAM_ACTIONS],
          Resource: "*",
          ...exemptionCondition(exemptArns),
        },
      ],
    },
    undefined,
    2
  );
