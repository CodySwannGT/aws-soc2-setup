/** Sid identifying the key-administration statement the CLI manages. */
export const KEY_ADMIN_SID = "Allow administration of the key";

/** Actions granted to a key administrator (ported from manage_kms_keys.sh). */
const KEY_ADMIN_ACTIONS = [
  "kms:Create*",
  "kms:Describe*",
  "kms:Enable*",
  "kms:List*",
  "kms:Put*",
  "kms:Update*",
  "kms:Revoke*",
  "kms:Disable*",
  "kms:Get*",
  "kms:Delete*",
  "kms:TagResource",
  "kms:UntagResource",
  "kms:ScheduleKeyDeletion",
  "kms:CancelKeyDeletion",
  "kms:RotateKeyOnDemand",
];

/** A single principal block; `AWS` may be a scalar ARN or an array of ARNs. */
export interface PrincipalBlock {
  AWS?: string | string[];
  [key: string]: unknown;
}

/** A KMS key policy statement. */
export interface PolicyStatement {
  Sid?: string;
  Effect: string;
  Principal: PrincipalBlock;
  Action: string | string[];
  Resource: string;
}

/** A KMS key policy document. */
export interface KeyPolicy {
  Version?: string;
  Id?: string;
  Statement: PolicyStatement[];
}

/**
 * Normalize a statement's `Principal.AWS` into an array of ARNs, regardless of
 * whether it was stored as a scalar, an array, or absent.
 * @param principal - The principal block to read.
 * @returns The principal ARNs as an array.
 */
const principalArns = (principal: PrincipalBlock): string[] => {
  const { AWS } = principal;
  if (Array.isArray(AWS)) {
    return AWS;
  }
  return typeof AWS === "string" ? [AWS] : [];
};

const newAdminStatement = (adminArn: string): PolicyStatement => ({
  Sid: KEY_ADMIN_SID,
  Effect: "Allow",
  Principal: { AWS: adminArn },
  Action: [...KEY_ADMIN_ACTIONS],
  Resource: "*",
});

const replaceStatement = (
  policy: KeyPolicy,
  index: number,
  statement: PolicyStatement
): KeyPolicy => ({
  ...policy,
  Statement: policy.Statement.map((existing, i) =>
    i === index ? statement : existing
  ),
});

/**
 * Add an administrator ARN to the key-administration statement, creating that
 * statement if it does not yet exist. Idempotent — adding an ARN that is already
 * present returns the policy unchanged. Pure: returns a new policy object.
 * @param policy - The current key policy.
 * @param adminArn - The IAM user/role ARN to grant administration.
 * @returns The updated key policy.
 */
export const addAdministratorToPolicy = (
  policy: KeyPolicy,
  adminArn: string
): KeyPolicy => {
  const index = policy.Statement.findIndex(s => s.Sid === KEY_ADMIN_SID);
  if (index === -1) {
    return {
      ...policy,
      Statement: [...policy.Statement, newAdminStatement(adminArn)],
    };
  }

  const statement = policy.Statement[index]!;
  const arns = principalArns(statement.Principal);
  if (arns.includes(adminArn)) {
    return policy;
  }

  return replaceStatement(policy, index, {
    ...statement,
    Principal: { ...statement.Principal, AWS: [...arns, adminArn] },
  });
};

/**
 * Remove an administrator ARN from the key-administration statement. Idempotent
 * — removing an absent ARN (or when no admin statement exists) returns the
 * policy unchanged. Pure: returns a new policy object.
 * @param policy - The current key policy.
 * @param adminArn - The IAM user/role ARN to revoke.
 * @returns The updated key policy.
 */
export const removeAdministratorFromPolicy = (
  policy: KeyPolicy,
  adminArn: string
): KeyPolicy => {
  const index = policy.Statement.findIndex(s => s.Sid === KEY_ADMIN_SID);
  if (index === -1) {
    return policy;
  }

  const statement = policy.Statement[index]!;
  const arns = principalArns(statement.Principal).filter(
    arn => arn !== adminArn
  );

  return replaceStatement(policy, index, {
    ...statement,
    Principal: { ...statement.Principal, AWS: arns },
  });
};
