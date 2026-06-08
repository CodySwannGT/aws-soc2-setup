import { describe, expect, it } from "vitest";

import {
  KEY_ADMIN_SID,
  addAdministratorToPolicy,
  removeAdministratorFromPolicy,
  type KeyPolicy,
} from "../../src/kms/policy.js";

const ADMIN_A = "arn:aws:iam::123456789012:role/AdminA";
const ADMIN_B = "arn:aws:iam::123456789012:role/AdminB";

const policyWithAdmins = (aws: string | string[]): KeyPolicy => ({
  Version: "2012-10-17",
  Statement: [
    {
      Sid: KEY_ADMIN_SID,
      Effect: "Allow",
      Principal: { AWS: aws },
      Action: "kms:*",
      Resource: "*",
    },
  ],
});

const emptyPolicy = (): KeyPolicy => ({
  Version: "2012-10-17",
  Statement: [
    {
      Sid: "Enable IAM",
      Effect: "Allow",
      Principal: { AWS: "root" },
      Action: "kms:*",
      Resource: "*",
    },
  ],
});

const adminStatement = (policy: KeyPolicy) =>
  policy.Statement.find(statement => statement.Sid === KEY_ADMIN_SID);

describe("addAdministratorToPolicy", () => {
  it("creates the admin statement when none exists", () => {
    const result = addAdministratorToPolicy(emptyPolicy(), ADMIN_A);
    const statement = adminStatement(result);
    expect(statement?.Principal.AWS).toBe(ADMIN_A);
    expect(Array.isArray(statement?.Action)).toBe(true);
  });

  it("promotes a scalar principal to an array when adding a second admin", () => {
    const result = addAdministratorToPolicy(policyWithAdmins(ADMIN_A), ADMIN_B);
    expect(adminStatement(result)?.Principal.AWS).toEqual([ADMIN_A, ADMIN_B]);
  });

  it("is idempotent when the admin is already present", () => {
    const input = policyWithAdmins([ADMIN_A]);
    expect(addAdministratorToPolicy(input, ADMIN_A)).toBe(input);
  });

  it("does not mutate the input policy", () => {
    const input = policyWithAdmins(ADMIN_A);
    addAdministratorToPolicy(input, ADMIN_B);
    expect(input.Statement[0]?.Principal.AWS).toBe(ADMIN_A);
  });
});

describe("removeAdministratorFromPolicy", () => {
  it("removes the admin from an array principal", () => {
    const result = removeAdministratorFromPolicy(
      policyWithAdmins([ADMIN_A, ADMIN_B]),
      ADMIN_A
    );
    expect(adminStatement(result)?.Principal.AWS).toEqual([ADMIN_B]);
  });

  it("clears a scalar principal that matches", () => {
    const result = removeAdministratorFromPolicy(
      policyWithAdmins(ADMIN_A),
      ADMIN_A
    );
    expect(adminStatement(result)?.Principal.AWS).toEqual([]);
  });

  it("returns the policy unchanged when no admin statement exists", () => {
    const input = emptyPolicy();
    expect(removeAdministratorFromPolicy(input, ADMIN_A)).toBe(input);
  });
});
