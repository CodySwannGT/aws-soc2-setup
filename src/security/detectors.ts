import {
  CreateDetectorCommand,
  GuardDutyClient,
  ListDetectorsCommand,
  UpdateDetectorCommand,
} from "@aws-sdk/client-guardduty";
import {
  BatchGetAccountStatusCommand,
  Inspector2Client,
  EnableCommand,
  UpdateConfigurationCommand,
} from "@aws-sdk/client-inspector2";
import {
  EnableMacieCommand,
  Macie2Client,
  UpdateAutomatedDiscoveryConfigurationCommand,
} from "@aws-sdk/client-macie2";
import {
  BatchEnableStandardsCommand,
  EnableSecurityHubCommand,
  SecurityHubClient,
} from "@aws-sdk/client-securityhub";

import { buildClientConfig } from "../lib/aws.js";
import { success, warn } from "../lib/logger.js";
import { realDelay, type DelayFn } from "../lib/retry.js";

import type { SecurityContext } from "./config.js";

const CIS_ARN =
  "arn:aws:securityhub:::ruleset/cis-aws-foundations-benchmark/v/1.2.0";
const FINDING_FREQUENCY = "FIFTEEN_MINUTES";
/** Poll interval and attempt budget while Inspector finishes enabling ECR. */
const INSPECTOR_POLL_MS = 5_000;
const INSPECTOR_POLL_ATTEMPTS = 24;

const attempt = async (
  op: () => Promise<unknown>,
  okMessage: string,
  failMessage: string
): Promise<void> => {
  try {
    await op();
    success(okMessage);
  } catch (caught) {
    warn(
      `${failMessage}: ${caught instanceof Error ? caught.message : String(caught)}`
    );
  }
};

/**
 * Enable Amazon GuardDuty, creating a detector if none exists or refreshing the
 * existing detector's settings (15-minute finding frequency).
 * @param context - AWS region/profile context.
 */
export const enableGuardDuty = async (
  context: SecurityContext
): Promise<void> => {
  const client = new GuardDutyClient(buildClientConfig(context));
  const list = await client.send(new ListDetectorsCommand({}));
  const existing = list.DetectorIds?.[0];
  if (existing) {
    await attempt(
      () =>
        client.send(
          new UpdateDetectorCommand({
            DetectorId: existing,
            Enable: true,
            FindingPublishingFrequency: FINDING_FREQUENCY,
          })
        ),
      `Updated GuardDuty detector ${existing}`,
      "Failed to update GuardDuty detector settings"
    );
    return;
  }
  await attempt(
    () =>
      client.send(
        new CreateDetectorCommand({
          Enable: true,
          FindingPublishingFrequency: FINDING_FREQUENCY,
        })
      ),
    "Enabled GuardDuty",
    "Failed to enable GuardDuty"
  );
};

/**
 * Enable AWS Security Hub with default standards and the CIS AWS Foundations
 * Benchmark.
 * @param context - AWS region/profile context.
 */
export const enableSecurityHub = async (
  context: SecurityContext
): Promise<void> => {
  const client = new SecurityHubClient(buildClientConfig(context));
  await attempt(
    () =>
      client.send(
        new EnableSecurityHubCommand({ EnableDefaultStandards: true })
      ),
    "Enabled Security Hub with default standards",
    "Security Hub may already be enabled"
  );
  await attempt(
    () =>
      client.send(
        new BatchEnableStandardsCommand({
          StandardsSubscriptionRequests: [{ StandardsArn: CIS_ARN }],
        })
      ),
    "Enabled CIS AWS Foundations Benchmark",
    "CIS standard may already be enabled"
  );
};

/**
 * Enable Amazon Macie and automated sensitive-data discovery.
 * @param context - AWS region/profile context.
 */
export const enableMacie = async (context: SecurityContext): Promise<void> => {
  const client = new Macie2Client(buildClientConfig(context));
  await attempt(
    () => client.send(new EnableMacieCommand({})),
    "Enabled Macie",
    "Macie may already be enabled"
  );
  await attempt(
    () =>
      client.send(
        new UpdateAutomatedDiscoveryConfigurationCommand({ status: "ENABLED" })
      ),
    "Enabled automated sensitive data discovery",
    "Failed to enable automated sensitive data discovery"
  );
};

const ecrScanStatus = async (
  client: Inspector2Client
): Promise<string | undefined> => {
  try {
    const result = await client.send(new BatchGetAccountStatusCommand({}));
    return result.accounts?.[0]?.resourceState?.ecr?.status;
  } catch (caught) {
    warn(
      `Could not read Inspector account status: ${caught instanceof Error ? caught.message : String(caught)}`
    );
    return undefined;
  }
};

/**
 * `Enable` is asynchronous: ECR scanning sits in `ENABLING` for a while, and
 * Inspector rejects ECR configuration updates until it reaches `ENABLED`.
 * @param client - The Inspector client.
 * @param delay - Delay between polls.
 * @param attemptsLeft - Remaining status checks.
 * @returns The last observed ECR scan status.
 */
const waitForEcrScanning = async (
  client: Inspector2Client,
  delay: DelayFn,
  attemptsLeft = INSPECTOR_POLL_ATTEMPTS
): Promise<string | undefined> => {
  const status = await ecrScanStatus(client);
  if (status !== "ENABLING" || attemptsLeft <= 1) {
    return status;
  }
  await delay(INSPECTOR_POLL_MS);
  return waitForEcrScanning(client, delay, attemptsLeft - 1);
};

/**
 * Apply the 30-day ECR rescan once ECR scanning is active, or explain why not.
 * @param client - The Inspector client.
 * @param delay - Delay between account-status polls.
 */
const configureEcrRescan = async (
  client: Inspector2Client,
  delay: DelayFn
): Promise<void> => {
  const ecrStatus = await waitForEcrScanning(client, delay);
  if (ecrStatus !== "ENABLED") {
    warn(
      `Inspector ECR scanning is ${ecrStatus ?? "unknown"}, not ENABLED; skipping the ECR rescan setting. Re-run once it is active.`
    );
    return;
  }
  await attempt(
    () =>
      client.send(
        new UpdateConfigurationCommand({
          ecrConfiguration: { rescanDuration: "DAYS_30" },
        })
      ),
    "Configured Inspector scanning settings",
    "Failed to update Inspector scanning settings"
  );
};

/**
 * Enable Amazon Inspector for EC2, ECR, and Lambda, with a 30-day ECR rescan.
 * The rescan setting is applied once ECR scanning has finished enabling.
 * @param context - AWS region/profile context.
 * @param delay - Delay between account-status polls (injectable for tests).
 */
export const enableInspector = async (
  context: SecurityContext,
  delay: DelayFn = realDelay
): Promise<void> => {
  const client = new Inspector2Client(buildClientConfig(context));
  await attempt(
    () =>
      client.send(
        new EnableCommand({ resourceTypes: ["EC2", "ECR", "LAMBDA"] })
      ),
    "Enabled Inspector for EC2, ECR, and Lambda",
    "Inspector may already be enabled"
  );
  await configureEcrRescan(client, delay);
};
