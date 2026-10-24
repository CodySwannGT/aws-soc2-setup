import {
  EnableOrganizationsRootCredentialsManagementCommand,
  EnableOrganizationsRootSessionsCommand,
  IAMClient,
  ListOrganizationsFeaturesCommand,
  type FeatureType,
} from "@aws-sdk/client-iam";
import {
  EnableAWSServiceAccessCommand,
  OrganizationsClient,
} from "@aws-sdk/client-organizations";

import { buildClientConfig } from "../lib/aws.js";
import { warn } from "../lib/logger.js";

import type { RootContext } from "./access-keys.js";

/** Whether an IAM organization root feature is enabled (and why not). */
export interface FeatureStatus {
  enabled: boolean;
  reason?: string;
}

/** Status of the IAM organization features centralized root access needs. */
export type RootManagementStatus = Record<
  "RootCredentialsManagement" | "RootSessions",
  FeatureStatus
>;

const iamClient = (context: RootContext): IAMClient =>
  new IAMClient(buildClientConfig(context));

const errorMessage = (error: unknown): string =>
  error instanceof Error ? error.message : String(error);

const enableIamTrustedAccess = async (context: RootContext): Promise<void> => {
  try {
    await new OrganizationsClient(buildClientConfig(context)).send(
      new EnableAWSServiceAccessCommand({
        ServicePrincipal: "iam.amazonaws.com",
      })
    );
  } catch {
    warn("IAM trusted access is already enabled or could not be enabled");
  }
};

const listEnabledFeatures = async (
  context: RootContext
): Promise<FeatureType[]> => {
  try {
    const result = await iamClient(context).send(
      new ListOrganizationsFeaturesCommand({})
    );
    return result.EnabledFeatures ?? [];
  } catch {
    return [];
  }
};

const ensureFeature = async (
  enabled: FeatureType[],
  feature: FeatureType,
  enable: () => Promise<unknown>
): Promise<FeatureStatus> => {
  if (enabled.includes(feature)) {
    return { enabled: true };
  }
  try {
    await enable();
    return { enabled: true };
  } catch (error) {
    return { enabled: false, reason: errorMessage(error) };
  }
};

const ensureRootFeatures = async (
  context: RootContext,
  enabled: FeatureType[]
): Promise<RootManagementStatus> => ({
  RootCredentialsManagement: await ensureFeature(
    enabled,
    "RootCredentialsManagement",
    () =>
      iamClient(context).send(
        new EnableOrganizationsRootCredentialsManagementCommand({})
      )
  ),
  RootSessions: await ensureFeature(enabled, "RootSessions", () =>
    iamClient(context).send(new EnableOrganizationsRootSessionsCommand({}))
  ),
});

/**
 * Enable IAM trusted access plus the two organization-level root features
 * (`RootCredentialsManagement`, `RootSessions`), skipping any already on.
 * @param context - AWS region/profile context.
 * @returns The resulting status of each root feature.
 */
export const enableRootManagement = async (
  context: RootContext
): Promise<RootManagementStatus> => {
  await enableIamTrustedAccess(context);
  return ensureRootFeatures(context, await listEnabledFeatures(context));
};
