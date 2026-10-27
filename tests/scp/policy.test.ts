import { describe, expect, it } from "vitest";

import { CliError } from "../../src/lib/errors.js";
import {
  buildDenyIamUsersPolicy,
  DENIED_IAM_ACTIONS,
  DENIED_IAM_EVENT_NAMES,
  parseScopedUserExemption,
  SCOPED_EXEMPTION_SID_PREFIX,
  SCP_MAX_CHARACTERS,
  validateScopedUserExemption,
  type ScopedUserExemption,
} from "../../src/scp/policy.js";

/** Shape of a statement inside the deny-IAM-users SCP document. */
interface ScpStatement {
  Sid: string;
  Effect: string;
  Action: string[];
  Resource?: string;
  NotResource?: string[];
  Condition?: {
    ArnNotLike?: { "aws:PrincipalArn"?: string[] };
    ArnLike?: { "aws:PrincipalArn"?: string };
  };
}

const BREAK_GLASS = "arn:aws:iam::*:role/break-glass/*";
const SCOPED: ScopedUserExemption = {
  principalArnPattern:
    "arn:aws:iam::687562730697:role/cdk-hnb659fds-cfn-exec-role-687562730697-us-east-1",
  userArn: "arn:aws:iam::687562730697:user/remote-agent",
};

const parseDocument = (document: string): { Statement: ScpStatement[] } =>
  JSON.parse(document) as { Statement: ScpStatement[] };

const parseStatement = (document: string): ScpStatement => {
  const statement = parseDocument(document).Statement[0];
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

  it("emits only the base statement with zero scoped exemptions", () => {
    expect(parseDocument(buildDenyIamUsersPolicy([], [])).Statement).toEqual(
      parseDocument(buildDenyIamUsersPolicy()).Statement
    );
    expect(parseDocument(buildDenyIamUsersPolicy()).Statement).toHaveLength(1);
  });

  it("adds a NotResource deny scoped to the user for one exemption", () => {
    const document = parseDocument(
      buildDenyIamUsersPolicy([BREAK_GLASS], [SCOPED])
    );
    expect(document.Statement).toHaveLength(2);
    const [base, scoped] = document.Statement;
    expect(base?.Resource).toBe("*");
    expect(base?.Condition?.ArnNotLike?.["aws:PrincipalArn"]).toEqual([
      BREAK_GLASS,
      SCOPED.principalArnPattern,
    ]);
    expect(scoped).toEqual({
      Sid: `${SCOPED_EXEMPTION_SID_PREFIX}1`,
      Effect: "Deny",
      Action: [...DENIED_IAM_ACTIONS],
      NotResource: [SCOPED.userArn],
      Condition: {
        ArnLike: { "aws:PrincipalArn": SCOPED.principalArnPattern },
      },
    });
    expect(scoped?.Resource).toBeUndefined();
  });

  it("gives each of two exemptions its own uniquely-named statement", () => {
    const second: ScopedUserExemption = {
      principalArnPattern: "arn:aws:iam::*:role/deployers/*",
      userArn: "arn:aws:iam::222222222222:user/svc/ci-bot",
    };
    const document = parseDocument(
      buildDenyIamUsersPolicy([], [SCOPED, second])
    );
    const sids = document.Statement.map(statement => statement.Sid);
    expect(sids).toEqual([
      "DenyLongLivedIamCredentials",
      `${SCOPED_EXEMPTION_SID_PREFIX}1`,
      `${SCOPED_EXEMPTION_SID_PREFIX}2`,
    ]);
    expect(document.Statement[2]?.NotResource).toEqual([second.userArn]);
    expect(
      document.Statement[0]?.Condition?.ArnNotLike?.["aws:PrincipalArn"]
    ).toEqual([SCOPED.principalArnPattern, second.principalArnPattern]);
  });

  it("lists a principal once when it is both exempt and scoped", () => {
    const document = parseDocument(
      buildDenyIamUsersPolicy([SCOPED.principalArnPattern], [SCOPED])
    );
    expect(
      document.Statement[0]?.Condition?.ArnNotLike?.["aws:PrincipalArn"]
    ).toEqual([SCOPED.principalArnPattern]);
  });

  it("stays within the AWS SCP size limit for a handful of exemptions", () => {
    const content = buildDenyIamUsersPolicy([BREAK_GLASS], [SCOPED]);
    expect(content.length).toBeLessThanOrEqual(SCP_MAX_CHARACTERS);
  });

  it("fails clearly when exemptions push the SCP over the size limit", () => {
    const many = Array.from({ length: 20 }, (_, index) => ({
      principalArnPattern: `arn:aws:iam::111111111111:role/deployer-${index}`,
      userArn: `arn:aws:iam::111111111111:user/ci-bot-${index}`,
    }));
    expect(() => buildDenyIamUsersPolicy([], many)).toThrow(CliError);
    expect(() => buildDenyIamUsersPolicy([], many)).toThrow(
      /over the 5120-character AWS limit/
    );
  });

  it("rejects invalid scoped exemptions passed to the builder", () => {
    expect(() =>
      buildDenyIamUsersPolicy([], [{ ...SCOPED, userArn: "ci-bot" }])
    ).toThrow(CliError);
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

describe("validateScopedUserExemption", () => {
  it("accepts a concrete user ARN, including a path", () => {
    expect(validateScopedUserExemption(SCOPED)).toEqual(SCOPED);
    const withPath = {
      ...SCOPED,
      userArn: "arn:aws:iam::687562730697:user/agents/remote-agent",
    };
    expect(validateScopedUserExemption(withPath)).toEqual(withPath);
  });

  it("accepts a wildcard principal pattern", () => {
    const wildcard = { ...SCOPED, principalArnPattern: BREAK_GLASS };
    expect(validateScopedUserExemption(wildcard)).toEqual(wildcard);
  });

  it.each([
    "arn:aws:iam::687562730697:user/*",
    "arn:aws:iam::687562730697:user/remote-?",
    "arn:aws:iam::*:user/remote-agent",
    "arn:aws:iam::68756273069:user/remote-agent",
    "arn:aws:iam::687562730697:role/remote-agent",
    "arn:aws:iam::687562730697:user/",
    "arn:aws:sts::687562730697:user/remote-agent",
    "remote-agent",
  ])("rejects the user ARN %s", userArn => {
    expect(() => validateScopedUserExemption({ ...SCOPED, userArn })).toThrow(
      /concrete IAM user ARN/
    );
  });

  it.each([
    "arn:aws:sts::687562730697:assumed-role/x/y",
    "role/deployer",
    "arn:aws:iam::",
    "",
  ])("rejects the principal %s", principalArnPattern => {
    expect(() =>
      validateScopedUserExemption({ ...SCOPED, principalArnPattern })
    ).toThrow(/expected an IAM ARN/);
  });
});

describe("parseScopedUserExemption", () => {
  it("splits principal=userArn", () => {
    expect(
      parseScopedUserExemption(
        `${SCOPED.principalArnPattern}=${SCOPED.userArn}`
      )
    ).toEqual(SCOPED);
  });

  it("trims whitespace around each side", () => {
    expect(
      parseScopedUserExemption(
        ` ${SCOPED.principalArnPattern} = ${SCOPED.userArn} `
      )
    ).toEqual(SCOPED);
  });

  it.each([
    SCOPED.userArn,
    `${SCOPED.principalArnPattern}=`,
    `=${SCOPED.userArn}`,
    `${SCOPED.principalArnPattern}=${SCOPED.userArn}=extra`,
  ])("rejects the malformed value %s", spec => {
    expect(() => parseScopedUserExemption(spec)).toThrow(
      /expected <principalArnPattern>=<userArn>/
    );
  });

  it("validates the parsed ARNs", () => {
    expect(() =>
      parseScopedUserExemption(
        `${SCOPED.principalArnPattern}=arn:aws:iam::687562730697:user/*`
      )
    ).toThrow(CliError);
  });
});
