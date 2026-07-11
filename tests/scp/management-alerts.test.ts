import {
  EventBridgeClient,
  PutRuleCommand,
  PutTargetsCommand,
} from "@aws-sdk/client-eventbridge";
import {
  CreateTopicCommand,
  ListSubscriptionsByTopicCommand,
  SetTopicAttributesCommand,
  SNSClient,
  SubscribeCommand,
} from "@aws-sdk/client-sns";
import { mockClient } from "aws-sdk-client-mock";
import { beforeEach, describe, expect, it } from "vitest";

import {
  buildAlertEventPattern,
  ensureAlertRule,
  ensureAlertTopic,
  subscribeEmail,
} from "../../src/scp/management-alerts.js";

const snsMock = mockClient(SNSClient);
const eventsMock = mockClient(EventBridgeClient);

const CTX = { region: "us-east-1" };
const TOPIC_ARN = "arn:aws:sns:us-east-1:111111111111:iam-credential-alerts";
const EMAIL = "security@example.com";

describe("scp/management-alerts", () => {
  beforeEach(() => {
    snsMock.reset();
    eventsMock.reset();
  });

  it("ensureAlertTopic creates the topic and grants EventBridge publish", async () => {
    snsMock.on(CreateTopicCommand).resolves({ TopicArn: TOPIC_ARN });
    snsMock.on(SetTopicAttributesCommand).resolves({});
    await expect(ensureAlertTopic(CTX, "iam-credential-alerts")).resolves.toBe(
      TOPIC_ARN
    );
    const attributeCalls = snsMock.commandCalls(SetTopicAttributesCommand);
    expect(attributeCalls).toHaveLength(1);
    const policy = String(attributeCalls[0]?.args[0].input.AttributeValue);
    expect(policy).toContain("events.amazonaws.com");
    expect(policy).toContain("arn:aws:iam::111111111111:root");
  });

  it("subscribeEmail creates a subscription when none exists", async () => {
    snsMock.on(ListSubscriptionsByTopicCommand).resolves({ Subscriptions: [] });
    snsMock.on(SubscribeCommand).resolves({});
    await expect(subscribeEmail(CTX, TOPIC_ARN, EMAIL)).resolves.toBe(true);
    expect(snsMock.commandCalls(SubscribeCommand)).toHaveLength(1);
  });

  it("subscribeEmail skips an existing subscription", async () => {
    snsMock.on(ListSubscriptionsByTopicCommand).resolves({
      Subscriptions: [{ Protocol: "email", Endpoint: EMAIL }],
    });
    await expect(subscribeEmail(CTX, TOPIC_ARN, EMAIL)).resolves.toBe(false);
    expect(snsMock.commandCalls(SubscribeCommand)).toHaveLength(0);
  });

  it("buildAlertEventPattern matches CloudTrail IAM credential events", () => {
    const pattern = JSON.parse(buildAlertEventPattern()) as {
      source: string[];
      detail: { eventSource: string[]; eventName: string[] };
    };
    expect(pattern.source).toEqual(["aws.iam"]);
    expect(pattern.detail.eventSource).toEqual(["iam.amazonaws.com"]);
    expect(pattern.detail.eventName).toContain("CreateUser");
    expect(pattern.detail.eventName).toContain("CreateAccessKey");
  });

  it("ensureAlertRule creates the rule and points it at the topic", async () => {
    eventsMock.on(PutRuleCommand).resolves({});
    eventsMock.on(PutTargetsCommand).resolves({});
    await ensureAlertRule(CTX, "iam-credential-creation-alert", TOPIC_ARN);
    const ruleCalls = eventsMock.commandCalls(PutRuleCommand);
    expect(ruleCalls).toHaveLength(1);
    expect(ruleCalls[0]?.args[0].input.State).toBe("ENABLED");
    const targetCalls = eventsMock.commandCalls(PutTargetsCommand);
    expect(targetCalls[0]?.args[0].input.Targets?.[0]?.Arn).toBe(TOPIC_ARN);
  });
});
