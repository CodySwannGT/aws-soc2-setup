import {
  ControlCatalogClient,
  ListControlsCommand,
} from "@aws-sdk/client-controlcatalog";
import {
  ControlTowerClient,
  EnableControlCommand,
} from "@aws-sdk/client-controltower";
import {
  DescribeOrganizationCommand,
  ListRootsCommand,
  OrganizationsClient,
} from "@aws-sdk/client-organizations";
import {
  BatchEnableStandardsCommand,
  DescribeStandardsCommand,
  EnableSecurityHubCommand,
  SecurityHubClient,
} from "@aws-sdk/client-securityhub";

import { buildClientConfig } from "../lib/aws.js";
import { CliError } from "../lib/errors.js";

import {
  CONFIG_RULE_CONTROLS,
  LANDING_ZONE_MANDATORY_CONTROLS,
} from "./control-catalog.js";
import { controlIdentifierFormats } from "./controls.js";
import type { ControlTowerContext } from "./organizations.js";

const FSBP_NAME = "AWS Foundational Security Best Practices v1.0.0";
const CIS_NAME = "CIS AWS Foundations Benchmark v1.2.0";
const ORG_ID_PATTERN = /(o-[a-z0-9]+)/;

const ctClient = (context: ControlTowerContext): ControlTowerClient =>
  new ControlTowerClient(buildClientConfig(context));

const catalogClient = (context: ControlTowerContext): ControlCatalogClient =>
  new ControlCatalogClient(buildClientConfig(context));

const orgClient = (context: ControlTowerContext): OrganizationsClient =>
  new OrganizationsClient(buildClientConfig(context));

const hubClient = (context: ControlTowerContext): SecurityHubClient =>
  new SecurityHubClient(buildClientConfig(context));

const organizationIdFromDescribe = async (
  context: ControlTowerContext
): Promise<string | undefined> => {
  try {
    const result = await orgClient(context).send(
      new DescribeOrganizationCommand({})
    );
    return result.Organization?.Id;
  } catch {
    return undefined;
  }
};

const organizationIdFromRoots = async (
  context: ControlTowerContext
): Promise<string | undefined> => {
  try {
    const result = await orgClient(context).send(new ListRootsCommand({}));
    const arn = result.Roots?.[0]?.Arn ?? "";
    return ORG_ID_PATTERN.exec(arn)?.[1];
  } catch {
    return undefined;
  }
};

/**
 * Resolve the organization id, trying describe-organization then the root ARN.
 * @param context - AWS region/profile context.
 * @returns The organization id (`o-...`).
 * @throws {CliError} If the organization id cannot be determined.
 */
export const getOrganizationId = async (
  context: ControlTowerContext
): Promise<string> => {
  const direct = await organizationIdFromDescribe(context);
  const orgId = direct ?? (await organizationIdFromRoots(context));
  if (!orgId) {
    throw new CliError("Could not determine organization ID.");
  }
  return orgId;
};

/** Outcome of attempting to enable a single control on a target. */
export type ControlOutcome =
  | { status: "enabled" }
  | { status: "enforced" }
  | { status: "not-found"; reason: string }
  | { status: "failed"; reason: string };

const CONFIG_RULE_IMPLEMENTATION = "AWS::Config::ConfigRule";
const ENFORCED_BY_DEFAULT = /enforced by default/i;
const NOT_FOUND = /not found|does not exist/i;

const errorMessage = (caught: unknown): string =>
  caught instanceof Error ? caught.message : String(caught);

const isNotFound = (caught: unknown): boolean =>
  (caught instanceof Error && caught.name === "ResourceNotFoundException") ||
  NOT_FOUND.test(errorMessage(caught));

const classifyFailure = (caught: unknown): ControlOutcome => {
  const reason = errorMessage(caught);
  if (ENFORCED_BY_DEFAULT.test(reason)) {
    return { status: "enforced" };
  }
  if (isNotFound(caught)) {
    return { status: "not-found", reason };
  }
  return { status: "failed", reason };
};

const enableControl = async (
  context: ControlTowerContext,
  controlIdentifier: string,
  targetIdentifier: string
): Promise<ControlOutcome> => {
  try {
    await ctClient(context).send(
      new EnableControlCommand({ controlIdentifier, targetIdentifier })
    );
    return { status: "enabled" };
  } catch (caught) {
    return classifyFailure(caught);
  }
};

const isTerminal = (outcome: ControlOutcome): boolean =>
  outcome.status === "enabled" || outcome.status === "enforced";

const worseOutcome = (
  current: ControlOutcome,
  next: ControlOutcome
): ControlOutcome =>
  current.status === "failed" && next.status === "not-found" ? current : next;

const tryFormats = async (
  context: ControlTowerContext,
  formats: string[],
  targetIdentifier: string,
  best: ControlOutcome
): Promise<ControlOutcome> => {
  const [format, ...rest] = formats;
  if (format === undefined) {
    return best;
  }
  const outcome = await enableControl(context, format, targetIdentifier);
  if (isTerminal(outcome)) {
    return outcome;
  }
  return tryFormats(
    context,
    rest,
    targetIdentifier,
    worseOutcome(best, outcome)
  );
};

/**
 * Try each control-identifier format in order until one enables successfully.
 * A control the landing zone already enforces stops the search immediately; a
 * real failure on any format outranks "not found" on the others.
 * @param context - AWS region/profile context.
 * @param formats - Ordered candidate control identifiers.
 * @param targetIdentifier - The target OU ARN.
 * @returns The outcome of the best-performing format.
 */
export const enableControlWithFormats = (
  context: ControlTowerContext,
  formats: string[],
  targetIdentifier: string
): Promise<ControlOutcome> =>
  tryFormats(context, formats, targetIdentifier, {
    status: "not-found",
    reason: "No identifiers to try",
  });

/**
 * Look up the Control Catalog ARN of the detective control implemented by an
 * AWS Config managed rule.
 * @param context - AWS region/profile context.
 * @param ruleId - The AWS Config managed-rule identifier.
 * @returns The control ARN, or undefined if the catalog has no such control.
 */
export const resolveConfigRuleControlArn = async (
  context: ControlTowerContext,
  ruleId: string
): Promise<string | undefined> => {
  const result = await catalogClient(context).send(
    new ListControlsCommand({
      Filter: {
        Implementations: {
          Types: [CONFIG_RULE_IMPLEMENTATION],
          Identifiers: [ruleId],
        },
      },
    })
  );
  return result.Controls?.[0]?.Arn;
};

const enableConfigRuleControl = async (
  context: ControlTowerContext,
  ruleId: string,
  targetIdentifier: string
): Promise<ControlOutcome> => {
  const arn = await resolveConfigRuleControlArn(context, ruleId);
  if (!arn) {
    return {
      status: "not-found",
      reason: `No Control Catalog control implements AWS Config rule ${ruleId}`,
    };
  }
  return enableControlWithFormats(context, [arn], targetIdentifier);
};

/**
 * Enable one SOC 2 control on a target OU, routing by control kind:
 * landing-zone mandatory controls are reported as enforced without an API
 * call, AWS Config rule controls are resolved through the Control Catalog,
 * and legacy `AWS-GR_*` controls try each known identifier format.
 * @param context - AWS region/profile context.
 * @param controlId - The control id from the SOC 2 control sets.
 * @param targetIdentifier - The target OU ARN.
 * @returns The outcome for this control.
 */
export const enableSoc2Control = async (
  context: ControlTowerContext,
  controlId: string,
  targetIdentifier: string
): Promise<ControlOutcome> => {
  if (LANDING_ZONE_MANDATORY_CONTROLS.has(controlId)) {
    return { status: "enforced" };
  }
  if (CONFIG_RULE_CONTROLS.has(controlId)) {
    return enableConfigRuleControl(context, controlId, targetIdentifier);
  }
  return enableControlWithFormats(
    context,
    controlIdentifierFormats(controlId, context.region),
    targetIdentifier
  );
};

const findStandardArn = async (
  context: ControlTowerContext,
  name: string
): Promise<string | undefined> => {
  const result = await hubClient(context).send(
    new DescribeStandardsCommand({})
  );
  return result.Standards?.find(standard => standard.Name === name)
    ?.StandardsArn;
};

const enableStandard = async (
  context: ControlTowerContext,
  name: string
): Promise<boolean> => {
  const arn = await findStandardArn(context, name);
  if (!arn) {
    return false;
  }
  try {
    await hubClient(context).send(
      new BatchEnableStandardsCommand({
        StandardsSubscriptionRequests: [{ StandardsArn: arn }],
      })
    );
    return true;
  } catch {
    return false;
  }
};

/**
 * Fallback path: enable Security Hub and the AWS Foundational Security Best
 * Practices standard (then CIS if FSBP is unavailable).
 * @param context - AWS region/profile context.
 * @returns True if Security Hub plus a standard were enabled.
 */
export const enableSecurityHubFallback = async (
  context: ControlTowerContext
): Promise<boolean> => {
  try {
    await hubClient(context).send(new EnableSecurityHubCommand({}));
  } catch {
    return false;
  }
  return (
    (await enableStandard(context, FSBP_NAME)) ||
    (await enableStandard(context, CIS_NAME))
  );
};
