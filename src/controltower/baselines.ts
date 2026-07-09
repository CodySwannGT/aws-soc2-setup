import {
  ControlTowerClient,
  EnableBaselineCommand,
  GetBaselineOperationCommand,
  ListBaselinesCommand,
  ListEnabledBaselinesCommand,
} from "@aws-sdk/client-controltower";

import { buildClientConfig } from "../lib/aws.js";
import { CliError } from "../lib/errors.js";
import { collectPaged } from "../lib/paginate.js";

import type { ControlTowerContext } from "./organizations.js";

/** Name of the baseline that registers an OU with Control Tower. */
export const CONTROL_TOWER_BASELINE_NAME = "AWSControlTowerBaseline";

/** Name of the Identity Center landing-zone baseline. */
export const IDENTITY_CENTER_BASELINE_NAME = "IdentityCenterBaseline";

/** Parameter key required when Identity Center is enabled on the landing zone. */
export const IDENTITY_CENTER_BASELINE_PARAM =
  "IdentityCenterEnabledBaselineArn";

const ctClient = (context: ControlTowerContext): ControlTowerClient =>
  new ControlTowerClient(buildClientConfig(context));

/** A Control Tower baseline catalog entry. */
export interface BaselineSummary {
  arn: string;
  name: string;
}

/** An enabled baseline applied to a target (OU or account). */
export interface EnabledBaselineSummary {
  arn: string;
  baselineIdentifier: string;
  targetIdentifier: string;
  baselineVersion?: string;
  status?: string;
}

/** Result of registering (or finding) an OU under Control Tower governance. */
export interface RegisteredOu {
  ouArn: string;
  enabledBaselineArn: string;
  operationIdentifier?: string;
  alreadyRegistered: boolean;
}

const listAllBaselines = async (
  context: ControlTowerContext
): Promise<BaselineSummary[]> =>
  collectPaged(async token => {
    const page = await ctClient(context).send(
      new ListBaselinesCommand({ nextToken: token })
    );
    return {
      items: (page.baselines ?? [])
        .filter(
          (baseline): baseline is { arn: string; name: string } =>
            typeof baseline.arn === "string" &&
            typeof baseline.name === "string"
        )
        .map(baseline => ({ arn: baseline.arn, name: baseline.name })),
      next: page.nextToken,
    };
  });

/**
 * Resolve a baseline ARN by its catalog name (e.g. AWSControlTowerBaseline).
 * @param context - AWS region/profile context.
 * @param name - The baseline name.
 * @returns The baseline ARN.
 * @throws {CliError} If the baseline is not found.
 */
export const findBaselineArn = async (
  context: ControlTowerContext,
  name: string
): Promise<string> => {
  const baselines = await listAllBaselines(context);
  const match = baselines.find(baseline => baseline.name === name);
  if (!match) {
    throw new CliError(`Could not find Control Tower baseline '${name}'.`);
  }
  return match.arn;
};

const listEnabledBaselines = async (
  context: ControlTowerContext,
  filter?: {
    baselineIdentifiers?: string[];
    targetIdentifiers?: string[];
  }
): Promise<EnabledBaselineSummary[]> =>
  collectPaged(async token => {
    const page = await ctClient(context).send(
      new ListEnabledBaselinesCommand({
        nextToken: token,
        filter: filter
          ? {
              baselineIdentifiers: filter.baselineIdentifiers,
              targetIdentifiers: filter.targetIdentifiers,
            }
          : undefined,
      })
    );
    return {
      items: (page.enabledBaselines ?? []).flatMap(baseline => {
        if (
          typeof baseline.arn !== "string" ||
          typeof baseline.baselineIdentifier !== "string" ||
          typeof baseline.targetIdentifier !== "string"
        ) {
          return [];
        }
        return [
          {
            arn: baseline.arn,
            baselineIdentifier: baseline.baselineIdentifier,
            targetIdentifier: baseline.targetIdentifier,
            baselineVersion: baseline.baselineVersion,
            status: baseline.statusSummary?.status,
          },
        ];
      }),
      next: page.nextToken,
    };
  });

/**
 * Find the enabled Identity Center baseline ARN for the management account
 * (required as a parameter when enabling AWSControlTowerBaseline).
 * Optional: returns undefined when the Identity Center baseline is not in the
 * catalog or has not been enabled yet.
 * @param context - AWS region/profile context.
 * @returns The enabled Identity Center baseline ARN, if present.
 */
export const findIdentityCenterEnabledBaselineArn = async (
  context: ControlTowerContext
): Promise<string | undefined> => {
  const baselines = await listAllBaselines(context);
  const identityCenterBaselineArn = baselines.find(
    baseline => baseline.name === IDENTITY_CENTER_BASELINE_NAME
  )?.arn;
  if (!identityCenterBaselineArn) {
    return undefined;
  }
  const enabled = await listEnabledBaselines(context, {
    baselineIdentifiers: [identityCenterBaselineArn],
  });
  return enabled[0]?.arn;
};

/**
 * Return the enabled AWSControlTowerBaseline for an OU, if the OU is already
 * registered with Control Tower.
 * @param context - AWS region/profile context.
 * @param ouArn - The OU ARN.
 * @returns The enabled baseline summary, or undefined.
 */
export const findRegisteredOuBaseline = async (
  context: ControlTowerContext,
  ouArn: string
): Promise<EnabledBaselineSummary | undefined> => {
  const controlTowerBaselineArn = await findBaselineArn(
    context,
    CONTROL_TOWER_BASELINE_NAME
  );
  const enabled = await listEnabledBaselines(context, {
    baselineIdentifiers: [controlTowerBaselineArn],
    targetIdentifiers: [ouArn],
  });
  return enabled[0];
};

/**
 * Register an OU with Control Tower by enabling AWSControlTowerBaseline on it.
 * Idempotent: if the OU is already registered, returns the existing enabled
 * baseline without calling EnableBaseline again.
 * @param context - AWS region/profile context.
 * @param ouArn - The target OU ARN.
 * @param baselineVersion - Baseline version (should match the landing zone, e.g. "4.0").
 * @returns Registration result.
 */
export const registerOrganizationalUnit = async (
  context: ControlTowerContext,
  ouArn: string,
  baselineVersion: string
): Promise<RegisteredOu> => {
  const existing = await findRegisteredOuBaseline(context, ouArn);
  if (existing?.status === "SUCCEEDED") {
    return {
      ouArn,
      enabledBaselineArn: existing.arn,
      alreadyRegistered: true,
    };
  }

  const baselineIdentifier = await findBaselineArn(
    context,
    CONTROL_TOWER_BASELINE_NAME
  );
  const identityCenterEnabledBaselineArn =
    await findIdentityCenterEnabledBaselineArn(context);

  const result = await ctClient(context).send(
    new EnableBaselineCommand({
      baselineIdentifier,
      baselineVersion,
      targetIdentifier: ouArn,
      parameters: identityCenterEnabledBaselineArn
        ? [
            {
              key: IDENTITY_CENTER_BASELINE_PARAM,
              value: identityCenterEnabledBaselineArn,
            },
          ]
        : undefined,
    })
  );

  if (!result.arn) {
    throw new CliError(
      `EnableBaseline returned no enabled-baseline ARN for ${ouArn}.`
    );
  }

  return {
    ouArn,
    enabledBaselineArn: result.arn,
    operationIdentifier: result.operationIdentifier,
    alreadyRegistered: false,
  };
};

/**
 * Poll a baseline operation until it leaves UNDER_CHANGE / IN_PROGRESS.
 * @param context - AWS region/profile context.
 * @param operationIdentifier - The operation id from EnableBaseline.
 * @param delay - Injectable delay between polls (defaults to 5s).
 * @param remaining - Remaining poll attempts (defaults to 60 ≈ 5 minutes).
 * @returns The terminal operation status string.
 */
export const waitForBaselineOperation = async (
  context: ControlTowerContext,
  operationIdentifier: string,
  delay: (ms: number) => Promise<void> = ms =>
    new Promise(resolve => {
      setTimeout(resolve, ms);
    }),
  remaining = 60
): Promise<string> => {
  if (remaining <= 0) {
    throw new CliError(
      `Timed out waiting for baseline operation ${operationIdentifier}.`
    );
  }
  const result = await ctClient(context).send(
    new GetBaselineOperationCommand({ operationIdentifier })
  );
  const status = result.baselineOperation?.status;
  // BaselineOperationStatus is IN_PROGRESS | SUCCEEDED | FAILED (no UNDER_CHANGE).
  if (status && status !== "IN_PROGRESS") {
    return status;
  }
  await delay(5000);
  return waitForBaselineOperation(
    context,
    operationIdentifier,
    delay,
    remaining - 1
  );
};
