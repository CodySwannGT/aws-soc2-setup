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

import { buildClientConfig } from "../lib/aws.js";
import type { GlobalOptions } from "../lib/config.js";
import { CliError } from "../lib/errors.js";
import { collectPaged } from "../lib/paginate.js";
import { DENIED_IAM_EVENT_NAMES } from "./policy.js";

/** AWS context for management-account alert operations. */
export type AlertContext = Pick<GlobalOptions, "region" | "profile">;

/** Default name for the IAM credential-creation EventBridge rule. */
export const DEFAULT_ALERT_RULE_NAME = "iam-credential-creation-alert";

/** Default name for the SNS topic the rule publishes to. */
export const DEFAULT_ALERT_TOPIC_NAME = "iam-credential-alerts";

/**
 * The region CloudTrail delivers global-service (IAM) events to. The alert
 * rule only fires when created here.
 */
export const IAM_EVENTS_REGION = "us-east-1";

const snsClient = (context: AlertContext): SNSClient =>
  new SNSClient(buildClientConfig(context));

const eventsClient = (context: AlertContext): EventBridgeClient =>
  new EventBridgeClient(buildClientConfig(context));

const topicPolicy = (topicArn: string): string => {
  const accountId = topicArn.split(":")[4];
  return JSON.stringify({
    Version: "2012-10-17",
    Statement: [
      {
        Sid: "AllowAccountOwner",
        Effect: "Allow",
        Principal: { AWS: `arn:aws:iam::${accountId}:root` },
        Action: "sns:*",
        Resource: topicArn,
      },
      {
        Sid: "AllowEventBridgePublish",
        Effect: "Allow",
        Principal: { Service: "events.amazonaws.com" },
        Action: "sns:Publish",
        Resource: topicArn,
      },
    ],
  });
};

/**
 * Create (or reuse) the alert SNS topic and grant EventBridge publish access.
 * `CreateTopic` is idempotent for an unchanged name, so this is safe to rerun.
 * @param context - AWS region/profile context.
 * @param topicName - The SNS topic name.
 * @returns The topic ARN.
 */
export const ensureAlertTopic = async (
  context: AlertContext,
  topicName: string
): Promise<string> => {
  const client = snsClient(context);
  const created = await client.send(
    new CreateTopicCommand({ Name: topicName })
  );
  if (!created.TopicArn) {
    throw new CliError(`SNS created topic ${topicName} but returned no ARN.`);
  }
  await client.send(
    new SetTopicAttributesCommand({
      TopicArn: created.TopicArn,
      AttributeName: "Policy",
      AttributeValue: topicPolicy(created.TopicArn),
    })
  );
  return created.TopicArn;
};

/**
 * Subscribe an email address to the alert topic unless already subscribed.
 * New subscriptions stay pending until the recipient confirms via email.
 * @param context - AWS region/profile context.
 * @param topicArn - The topic to subscribe to.
 * @param email - The email address to notify.
 * @returns True when a new subscription was created; false when it existed.
 */
export const subscribeEmail = async (
  context: AlertContext,
  topicArn: string,
  email: string
): Promise<boolean> => {
  const client = snsClient(context);
  const subscriptions = await collectPaged(async token => {
    const page = await client.send(
      new ListSubscriptionsByTopicCommand({
        TopicArn: topicArn,
        NextToken: token,
      })
    );
    return { items: page.Subscriptions ?? [], next: page.NextToken };
  });
  const existing = subscriptions.some(
    subscription =>
      subscription.Protocol === "email" && subscription.Endpoint === email
  );
  if (existing) {
    return false;
  }
  await client.send(
    new SubscribeCommand({
      TopicArn: topicArn,
      Protocol: "email",
      Endpoint: email,
    })
  );
  return true;
};

/**
 * Build the EventBridge pattern matching CloudTrail IAM credential-creation
 * events (the same calls the org SCP denies in member accounts).
 * @returns The event pattern as a JSON string.
 */
export const buildAlertEventPattern = (): string =>
  JSON.stringify({
    source: ["aws.iam"],
    "detail-type": ["AWS API Call via CloudTrail"],
    detail: {
      eventSource: ["iam.amazonaws.com"],
      eventName: [...DENIED_IAM_EVENT_NAMES],
    },
  });

/**
 * Create (or update) the EventBridge rule that publishes IAM
 * credential-creation events to the alert topic. Idempotent — `PutRule` and
 * `PutTargets` overwrite in place.
 * @param context - AWS region/profile context.
 * @param ruleName - The EventBridge rule name.
 * @param topicArn - The SNS topic to publish matched events to.
 */
export const ensureAlertRule = async (
  context: AlertContext,
  ruleName: string,
  topicArn: string
): Promise<void> => {
  const client = eventsClient(context);
  await client.send(
    new PutRuleCommand({
      Name: ruleName,
      Description:
        "Alerts on IAM user / long-lived credential creation. Complements the " +
        "DenyLongLivedIamCredentials SCP, which cannot apply to the management account.",
      EventPattern: buildAlertEventPattern(),
      State: "ENABLED",
    })
  );
  await client.send(
    new PutTargetsCommand({
      Rule: ruleName,
      Targets: [{ Id: "sns-alert", Arn: topicArn }],
    })
  );
};
