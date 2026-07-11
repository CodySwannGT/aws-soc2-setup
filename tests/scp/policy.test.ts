import { describe, expect, it } from "vitest";

import {
  buildDenyIamUsersPolicy,
  DENIED_IAM_ACTIONS,
  DENIED_IAM_EVENT_NAMES,
} from "../../src/scp/policy.js";

/** Shape of the single statement inside the deny-IAM-users SCP document. */
interface ScpStatement {
  Sid: string;
  Effect: string;
  Action: string[];
  Resource: string;
  Condition?: { ArnNotLike?: { "aws:PrincipalArn"?: string[] } };
}

const parseStatement = (document: string): ScpStatement => {
  const parsed = JSON.parse(document) as { Statement: ScpStatement[] };
  const statement = parsed.Statement[0];
  if (!statement) {
    throw new Error("policy document has no statements");
  }
  return statement;
};

describe("buildDenyIamUsersPolicy", () => {
  it("denies every long-lived credential action on all resources", () => {
    const statement = parseStatement(buildDenyIamUsersPolicy());
    expect(statement.Effect).toBe("Deny");
    expect(statement.Resource).toBe("*");
    expect(statement.Action).toEqual([...DENIED_IAM_ACTIONS]);
    expect(statement.Action).toContain("iam:CreateUser");
    expect(statement.Action).toContain("iam:CreateAccessKey");
  });

  it("omits the condition when no exemptions are given", () => {
    const statement = parseStatement(buildDenyIamUsersPolicy());
    expect(statement.Condition).toBeUndefined();
  });

  it("exempts the given principal ARN patterns", () => {
    const exempt = "arn:aws:iam::*:role/break-glass/*";
    const statement = parseStatement(buildDenyIamUsersPolicy([exempt]));
    expect(statement.Condition?.ArnNotLike?.["aws:PrincipalArn"]).toEqual([
      exempt,
    ]);
  });

  it("derives CloudTrail event names from the denied actions", () => {
    expect(DENIED_IAM_EVENT_NAMES).toHaveLength(DENIED_IAM_ACTIONS.length);
    expect(DENIED_IAM_EVENT_NAMES).toContain("CreateUser");
    expect(DENIED_IAM_EVENT_NAMES).toContain("CreateAccessKey");
    expect(DENIED_IAM_EVENT_NAMES.every(name => !name.includes(":"))).toBe(
      true
    );
  });
});
