import type { Command } from "commander";

import { resolveGlobalOptions, type GlobalFlags } from "../lib/config.js";
import type { GlobalOptions } from "../lib/config.js";
import { CliError } from "../lib/errors.js";
import { info, success, warn } from "../lib/logger.js";
import { runAction } from "../lib/run.js";
import {
  DEFAULT_ALERT_RULE_NAME,
  DEFAULT_ALERT_TOPIC_NAME,
  ensureAlertRule,
  ensureAlertTopic,
  IAM_EVENTS_REGION,
  subscribeEmail,
} from "../scp/management-alerts.js";
import {
  buildDenyIamUsersPolicy,
  DENY_IAM_USERS_POLICY_DESCRIPTION,
  DENY_IAM_USERS_POLICY_NAME,
} from "../scp/policy.js";
import {
  attachPolicyToTarget,
  ensurePolicy,
  ensureScpTypeEnabled,
  getOrganizationRootId,
} from "../scp/scps.js";

/** Options for `scp deny-iam-users`. */
export interface DenyIamUsersOptions {
  target?: string[];
  exemptArn?: string[];
}

/** Options for `scp alert-management`. */
export interface AlertManagementOptions {
  email: string;
  ruleName?: string;
  topicName?: string;
}

const requireYes = (globals: GlobalOptions, action: string): void => {
  if (!globals.yes) {
    throw new CliError(
      `Refusing to ${action} without confirmation. Re-run with --yes to proceed.`
    );
  }
};

const resolveTargets = (
  options: DenyIamUsersOptions,
  rootId: string
): string[] =>
  options.target && options.target.length > 0 ? options.target : [rootId];

const provisionPolicy = async (
  globals: GlobalOptions,
  rootId: string,
  content: string
): Promise<{ id: string; created: boolean; updated: boolean }> => {
  await ensureScpTypeEnabled(globals, rootId);
  return ensurePolicy(
    globals,
    DENY_IAM_USERS_POLICY_NAME,
    DENY_IAM_USERS_POLICY_DESCRIPTION,
    content
  );
};

const attachToTargets = async (
  globals: GlobalOptions,
  policyId: string,
  targets: string[]
): Promise<void> => {
  for (const target of targets) {
    const attached = await attachPolicyToTarget(globals, policyId, target);
    if (attached) {
      success(`Attached ${DENY_IAM_USERS_POLICY_NAME} to ${target}`);
    } else {
      info(`${DENY_IAM_USERS_POLICY_NAME} already attached to ${target}`);
    }
  }
};

const reportEnsuredPolicy = (created: boolean, updated: boolean): void => {
  if (created) {
    success(`Created SCP ${DENY_IAM_USERS_POLICY_NAME}`);
    return;
  }
  if (updated) {
    success(`Updated SCP ${DENY_IAM_USERS_POLICY_NAME} (content drifted)`);
    return;
  }
  info(`SCP ${DENY_IAM_USERS_POLICY_NAME} already up to date`);
};

/**
 * Execute `scp deny-iam-users`: create the SCP that denies IAM user and
 * long-lived credential creation, and attach it to the organization root (or
 * the given targets). Requires `--yes`; `--dry-run` previews the policy.
 * @param globals - Resolved global options.
 * @param options - Attachment targets and exemption ARN patterns.
 */
export const handleDenyIamUsers = async (
  globals: GlobalOptions,
  options: DenyIamUsersOptions
): Promise<void> => {
  const content = buildDenyIamUsersPolicy(options.exemptArn ?? []);
  if (globals.dryRun) {
    const where = options.target?.join(", ") ?? "the organization root";
    info(`[dry-run] Would attach ${DENY_IAM_USERS_POLICY_NAME} to ${where}:`);
    info(content);
    return;
  }
  requireYes(globals, "attach an organization-wide deny SCP");
  await applyDenyIamUsers(globals, options, content);
};

const applyDenyIamUsers = async (
  globals: GlobalOptions,
  options: DenyIamUsersOptions,
  content: string
): Promise<void> => {
  const rootId = await getOrganizationRootId(globals);
  const targets = resolveTargets(options, rootId);
  const ensured = await provisionPolicy(globals, rootId, content);
  reportEnsuredPolicy(ensured.created, ensured.updated);
  await attachToTargets(globals, ensured.id, targets);
  warn(
    "The management account is exempt from SCPs by AWS design. Run " +
      "`scp alert-management --email <address>` for detective coverage there."
  );
};

/**
 * Execute `scp alert-management`: create the EventBridge rule + SNS topic
 * that alert on IAM credential creation — detective coverage for the
 * management account, which SCPs cannot bind. Requires `--yes`; `--dry-run`
 * previews. IAM events are global-service events delivered in us-east-1, so
 * the alert resources are always created there regardless of `--region`.
 * @param globals - Resolved global options.
 * @param options - Alert email and optional rule/topic names.
 */
export const handleAlertManagement = async (
  globals: GlobalOptions,
  options: AlertManagementOptions
): Promise<void> => {
  const ruleName = options.ruleName ?? DEFAULT_ALERT_RULE_NAME;
  const topicName = options.topicName ?? DEFAULT_ALERT_TOPIC_NAME;
  if (globals.dryRun) {
    info(
      `[dry-run] Would create EventBridge rule ${ruleName} -> SNS topic ` +
        `${topicName} -> ${options.email} (region ${IAM_EVENTS_REGION})`
    );
    return;
  }
  requireYes(globals, "create management-account IAM alerts");
  await applyAlertManagement(globals, options, ruleName, topicName);
};

const resolveAlertRegion = (globals: GlobalOptions): GlobalOptions => {
  if (globals.region === IAM_EVENTS_REGION) {
    return globals;
  }
  warn(
    `IAM CloudTrail events are delivered in ${IAM_EVENTS_REGION}; creating ` +
      `the alert resources there instead of ${globals.region}.`
  );
  return { ...globals, region: IAM_EVENTS_REGION };
};

const reportSubscription = (subscribed: boolean, email: string): void => {
  if (subscribed) {
    info(`Subscription created for ${email} — pending email confirmation`);
    return;
  }
  info(`${email} is already subscribed`);
};

const applyAlertManagement = async (
  globals: GlobalOptions,
  options: AlertManagementOptions,
  ruleName: string,
  topicName: string
): Promise<void> => {
  const context = resolveAlertRegion(globals);
  const topicArn = await ensureAlertTopic(context, topicName);
  const subscribed = await subscribeEmail(context, topicArn, options.email);
  success(`SNS topic ready: ${topicArn}`);
  reportSubscription(subscribed, options.email);
  await ensureAlertRule(context, ruleName, topicArn);
  success(`EventBridge rule ${ruleName} enabled`);
};

/**
 * Register the `scp` command group (deny-iam-users, alert-management).
 * @param program - The root commander program to attach the commands to.
 */
export const registerScp = (program: Command): void => {
  const globals = (): GlobalOptions =>
    resolveGlobalOptions(program.opts<GlobalFlags>());
  const scp = program
    .command("scp")
    .description(
      "Block long-lived IAM credentials org-wide and alert on the management account"
    );

  scp
    .command("deny-iam-users")
    .description(
      "Create and attach an SCP denying IAM user / access key creation (requires --yes)"
    )
    .option(
      "-t, --target <ids...>",
      "Root, OU, or account ids to attach to (defaults to the organization root)"
    )
    .option(
      "--exempt-arn <arns...>",
      "Principal ARN patterns exempt from the deny (e.g. a break-glass role)"
    )
    .action(async (options: DenyIamUsersOptions) => {
      await runAction(async () => {
        await handleDenyIamUsers(globals(), options);
      });
    });

  scp
    .command("alert-management")
    .description(
      "Alert on IAM credential creation in the management account, which SCPs cannot bind (requires --yes)"
    )
    .requiredOption("-e, --email <address>", "Email address to notify")
    .option(
      "--rule-name <name>",
      `EventBridge rule name (default ${DEFAULT_ALERT_RULE_NAME})`
    )
    .option(
      "--topic-name <name>",
      `SNS topic name (default ${DEFAULT_ALERT_TOPIC_NAME})`
    )
    .action(async (options: AlertManagementOptions) => {
      await runAction(async () => {
        await handleAlertManagement(globals(), options);
      });
    });
};
