import {
  EventBridgeClient,
  PutRuleCommand,
  PutTargetsCommand,
} from "@aws-sdk/client-eventbridge";
import {
  AttachPolicyCommand,
  CreatePolicyCommand,
  EnablePolicyTypeCommand,
  ListPoliciesCommand,
  ListRootsCommand,
  OrganizationsClient,
} from "@aws-sdk/client-organizations";
import {
  CreateTopicCommand,
  ListSubscriptionsByTopicCommand,
  SetTopicAttributesCommand,
  SNSClient,
  SubscribeCommand,
} from "@aws-sdk/client-sns";
import { mockClient } from "aws-sdk-client-mock";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  handleAlertManagement,
  handleDenyIamUsers,
} from "../../src/commands/scp.js";
import type { GlobalOptions } from "../../src/lib/config.js";
import { CliError } from "../../src/lib/errors.js";
import { buildProgram } from "../../src/program.js";

const orgMock = mockClient(OrganizationsClient);
const snsMock = mockClient(SNSClient);
const eventsMock = mockClient(EventBridgeClient);

const ROOT_ID = "r-abcd";
const POLICY_ID = "p-12345678";
const TOPIC_ARN = "arn:aws:sns:us-east-1:111111111111:iam-credential-alerts";
const EMAIL = "security@example.com";

const globals = (over: Partial<GlobalOptions> = {}): GlobalOptions => ({
  region: "us-east-1",
  dryRun: false,
  yes: false,
  ...over,
});

const mockHappyOrg = (): void => {
  orgMock.on(ListRootsCommand).resolves({ Roots: [{ Id: ROOT_ID }] });
  orgMock.on(EnablePolicyTypeCommand).resolves({});
  orgMock.on(ListPoliciesCommand).resolves({ Policies: [] });
  orgMock.on(CreatePolicyCommand).resolves({
    Policy: { PolicySummary: { Id: POLICY_ID } },
  });
  orgMock.on(AttachPolicyCommand).resolves({});
};

describe("handleDenyIamUsers", () => {
  beforeEach(() => {
    orgMock.reset();
    vi.spyOn(process.stdout, "write").mockReturnValue(true);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("refuses without --yes", async () => {
    await expect(handleDenyIamUsers(globals(), {})).rejects.toBeInstanceOf(
      CliError
    );
    expect(orgMock.commandCalls(CreatePolicyCommand)).toHaveLength(0);
  });

  it("previews without mutating under --dry-run", async () => {
    await handleDenyIamUsers(globals({ dryRun: true }), {});
    expect(orgMock.commandCalls(CreatePolicyCommand)).toHaveLength(0);
    expect(orgMock.commandCalls(AttachPolicyCommand)).toHaveLength(0);
  });

  it("creates the SCP and attaches it to the organization root", async () => {
    mockHappyOrg();
    await handleDenyIamUsers(globals({ yes: true }), {});
    expect(orgMock.commandCalls(CreatePolicyCommand)).toHaveLength(1);
    const attach = orgMock.commandCalls(AttachPolicyCommand);
    expect(attach).toHaveLength(1);
    expect(attach[0]?.args[0].input.TargetId).toBe(ROOT_ID);
  });

  it("attaches to explicit targets instead of the root", async () => {
    mockHappyOrg();
    await handleDenyIamUsers(globals({ yes: true }), {
      target: ["ou-abcd-11111111", "ou-abcd-22222222"],
    });
    const targets = orgMock
      .commandCalls(AttachPolicyCommand)
      .map(call => call.args[0].input.TargetId);
    expect(targets).toEqual(["ou-abcd-11111111", "ou-abcd-22222222"]);
  });
});

describe("handleAlertManagement", () => {
  beforeEach(() => {
    snsMock.reset();
    eventsMock.reset();
    vi.spyOn(process.stdout, "write").mockReturnValue(true);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("refuses without --yes", async () => {
    await expect(
      handleAlertManagement(globals(), { email: EMAIL })
    ).rejects.toBeInstanceOf(CliError);
    expect(snsMock.commandCalls(CreateTopicCommand)).toHaveLength(0);
  });

  it("previews without mutating under --dry-run", async () => {
    await handleAlertManagement(globals({ dryRun: true }), { email: EMAIL });
    expect(snsMock.commandCalls(CreateTopicCommand)).toHaveLength(0);
    expect(eventsMock.commandCalls(PutRuleCommand)).toHaveLength(0);
  });

  it("creates topic, subscription, and rule with --yes", async () => {
    snsMock.on(CreateTopicCommand).resolves({ TopicArn: TOPIC_ARN });
    snsMock.on(SetTopicAttributesCommand).resolves({});
    snsMock.on(ListSubscriptionsByTopicCommand).resolves({ Subscriptions: [] });
    snsMock.on(SubscribeCommand).resolves({});
    eventsMock.on(PutRuleCommand).resolves({});
    eventsMock.on(PutTargetsCommand).resolves({});
    await handleAlertManagement(globals({ yes: true }), { email: EMAIL });
    expect(snsMock.commandCalls(SubscribeCommand)).toHaveLength(1);
    expect(eventsMock.commandCalls(PutRuleCommand)).toHaveLength(1);
    expect(eventsMock.commandCalls(PutTargetsCommand)).toHaveLength(1);
  });

  it("overrides the region to us-east-1 with a warning", async () => {
    snsMock.on(CreateTopicCommand).resolves({ TopicArn: TOPIC_ARN });
    snsMock.on(SetTopicAttributesCommand).resolves({});
    snsMock.on(ListSubscriptionsByTopicCommand).resolves({ Subscriptions: [] });
    snsMock.on(SubscribeCommand).resolves({});
    eventsMock.on(PutRuleCommand).resolves({});
    eventsMock.on(PutTargetsCommand).resolves({});
    await handleAlertManagement(globals({ yes: true, region: "eu-west-1" }), {
      email: EMAIL,
    });
    expect(eventsMock.commandCalls(PutRuleCommand)).toHaveLength(1);
    const written = vi
      .mocked(process.stdout.write)
      .mock.calls.map(call => String(call[0]))
      .join("");
    expect(written).toContain("instead of eu-west-1");
  });
});

describe("scp deny-iam-users --exempt-user parsing", () => {
  const ROLE = "arn:aws:iam::111111111111:role/deployer";
  const USER = "arn:aws:iam::111111111111:user/ci-bot";
  const OTHER_ROLE = "arn:aws:iam::111111111111:role/other";
  const OTHER_USER = "arn:aws:iam::111111111111:user/svc/other-bot";
  const FLAG = "--exempt-user";
  const originalExitCode = process.exitCode;

  const run = async (...args: string[]): Promise<string> => {
    const out = vi.spyOn(process.stdout, "write").mockReturnValue(true);
    vi.spyOn(process.stderr, "write").mockReturnValue(true);
    await buildProgram().parseAsync([
      "node",
      "aws-soc2-setup",
      "--dry-run",
      "scp",
      "deny-iam-users",
      ...args,
    ]);
    return out.mock.calls.map(call => String(call[0])).join("");
  };

  beforeEach(() => {
    orgMock.reset();
    process.exitCode = undefined;
  });

  afterEach(() => {
    process.exitCode = originalExitCode;
    vi.restoreAllMocks();
  });

  it("parses a repeated principal=userArn into scoped statements", async () => {
    const written = await run(
      FLAG,
      `${ROLE}=${USER}`,
      FLAG,
      `${OTHER_ROLE}=${OTHER_USER}`
    );
    expect(process.exitCode).toBeUndefined();
    expect(written).toContain("DenyScopedExemptionOutsideItsUser1");
    expect(written).toContain("DenyScopedExemptionOutsideItsUser2");
    expect(written).toContain(`"${USER}"`);
    expect(written).toContain(`"${OTHER_USER}"`);
    expect(orgMock.commandCalls(CreatePolicyCommand)).toHaveLength(0);
  });

  it("rejects a value without the principal=userArn separator", async () => {
    await run(FLAG, ROLE);
    expect(process.exitCode).toBe(1);
  });

  it("rejects a wildcard user ARN", async () => {
    await run(FLAG, `${ROLE}=arn:aws:iam::111111111111:user/*`);
    expect(process.exitCode).toBe(1);
  });
});

describe("registerScp", () => {
  it("registers the scp command group with both subcommands", () => {
    const scp = buildProgram().commands.find(
      command => command.name() === "scp"
    );
    expect(scp).toBeDefined();
    const names = scp?.commands.map(command => command.name());
    expect(names).toContain("deny-iam-users");
    expect(names).toContain("alert-management");
  });
});
