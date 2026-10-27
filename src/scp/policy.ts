import { CliError } from "../lib/errors.js";

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

/** AWS Organizations' maximum SCP document size, in characters. */
export const SCP_MAX_CHARACTERS = 5120;

/**
 * A resource-scoped exemption: principals matching `principalArnPattern` may
 * mint long-lived credentials, but only for the single IAM user `userArn`.
 */
export interface ScopedUserExemption {
  principalArnPattern: string;
  userArn: string;
}

/** Sid prefix of the per-exemption statements (suffixed with a 1-based index). */
export const SCOPED_EXEMPTION_SID_PREFIX = "DenyScopedExemptionOutsideItsUser";

const USER_ARN_PATTERN =
  /^arn:aws:iam::\d{12}:user\/(?:[\w+=,.@-]+\/)*[\w+=,.@-]+$/;
const PRINCIPAL_ARN_PATTERN = /^arn:aws:iam::[^\s=]+$/;

/**
 * Validate a scoped exemption: the user must be one concrete IAM user ARN (no
 * wildcards) and the principal must be an IAM ARN (pattern).
 * @param exemption - The exemption to check.
 * @returns The exemption, unchanged, when valid.
 */
export const validateScopedUserExemption = (
  exemption: ScopedUserExemption
): ScopedUserExemption => {
  if (!PRINCIPAL_ARN_PATTERN.test(exemption.principalArnPattern)) {
    throw new CliError(
      `Invalid scoped exemption principal "${exemption.principalArnPattern}": ` +
        "expected an IAM ARN (pattern) starting with arn:aws:iam::"
    );
  }
  if (!USER_ARN_PATTERN.test(exemption.userArn)) {
    throw new CliError(
      `Invalid scoped exemption user "${exemption.userArn}": expected a ` +
        "concrete IAM user ARN arn:aws:iam::<12-digit account>:user/[path/]name " +
        "with no wildcards"
    );
  }
  return exemption;
};

/**
 * Parse a `--exempt-user` value of the form `<principalArnPattern>=<userArn>`.
 * @param spec - The raw CLI value.
 * @returns The validated scoped exemption.
 */
export const parseScopedUserExemption = (spec: string): ScopedUserExemption => {
  const parts = spec.split("=");
  const [principalArnPattern, userArn] = parts.map(part => part.trim());
  if (parts.length !== 2 || !principalArnPattern || !userArn) {
    throw new CliError(
      `Invalid --exempt-user "${spec}": expected <principalArnPattern>=<userArn>`
    );
  }
  return validateScopedUserExemption({ principalArnPattern, userArn });
};

const exemptionCondition = (
  exemptArns: readonly string[]
): Record<string, unknown> =>
  exemptArns.length === 0
    ? {}
    : { Condition: { ArnNotLike: { "aws:PrincipalArn": [...exemptArns] } } };

const scopedExemptionStatement = (
  exemption: ScopedUserExemption,
  index: number
): Record<string, unknown> => ({
  Sid: `${SCOPED_EXEMPTION_SID_PREFIX}${index + 1}`,
  Effect: "Deny",
  Action: [...DENIED_IAM_ACTIONS],
  NotResource: [exemption.userArn],
  Condition: {
    ArnLike: { "aws:PrincipalArn": exemption.principalArnPattern },
  },
});

const assertWithinScpLimit = (content: string): string => {
  if (content.length > SCP_MAX_CHARACTERS) {
    throw new CliError(
      `The ${DENY_IAM_USERS_POLICY_NAME} SCP would be ${content.length} ` +
        `characters, over the ${SCP_MAX_CHARACTERS}-character AWS limit. ` +
        "Use fewer or broader --exempt-arn / --exempt-user exemptions."
    );
  }
  return content;
};

/**
 * Build the SCP document that denies long-lived IAM credential creation.
 *
 * The first statement denies the actions on every resource for everyone
 * except the `exemptArns` principals and the scoped-exemption principals.
 * Each scoped exemption then adds a statement denying its principal the same
 * actions on every resource *except* its one user ARN, so it can mint
 * credentials for that user only.
 * @param exemptArns - Principal ARN patterns (e.g. a break-glass role path)
 * excluded from the deny entirely; empty for a blanket deny.
 * @param scopedExemptions - Principals allowed to mint credentials for one
 * named IAM user only.
 * @returns The policy document as a JSON string, ready for AWS Organizations.
 */
export const buildDenyIamUsersPolicy = (
  exemptArns: readonly string[] = [],
  scopedExemptions: readonly ScopedUserExemption[] = []
): string => {
  const validated = scopedExemptions.map(validateScopedUserExemption);
  const excluded = [
    ...new Set([
      ...exemptArns,
      ...validated.map(exemption => exemption.principalArnPattern),
    ]),
  ];
  return assertWithinScpLimit(
    JSON.stringify(
      {
        Version: "2012-10-17",
        Statement: [
          {
            Sid: "DenyLongLivedIamCredentials",
            Effect: "Deny",
            Action: [...DENIED_IAM_ACTIONS],
            Resource: "*",
            ...exemptionCondition(excluded),
          },
          ...validated.map(scopedExemptionStatement),
        ],
      },
      undefined,
      2
    )
  );
};
