import type { Command } from "commander";

import {
  ensureOrganization,
  ORGANIZATION_FEATURE_SET,
} from "../controltower/organizations.js";
import type { GlobalOptions } from "../lib/config.js";
import { info, success } from "../lib/logger.js";
import { runAction } from "../lib/run.js";

/**
 * Execute `controltower create-organization`: create an AWS Organization with
 * feature set ALL if one does not already exist. Idempotent; does not modify
 * existing workloads in the management account. Honors `--dry-run`.
 * @param globals - Resolved global options.
 */
export const handleCreateOrganization = async (
  globals: GlobalOptions
): Promise<void> => {
  if (globals.dryRun) {
    info(
      `[dry-run] Would create an AWS Organization with FeatureSet=${ORGANIZATION_FEATURE_SET} if none exists`
    );
    return;
  }

  const result = await ensureOrganization(globals);
  const { organization } = result;
  const management = organization.managementAccountId
    ? ` (management ${organization.managementAccountId})`
    : "";

  if (result.created) {
    success(
      `Created AWS Organization ${organization.id}${management} with FeatureSet=${organization.featureSet ?? ORGANIZATION_FEATURE_SET}`
    );
    return;
  }

  const feature = organization.featureSet
    ? ` FeatureSet=${organization.featureSet}`
    : "";
  info(
    `AWS Organization already exists: ${organization.id}${management}${feature}`
  );
};

/**
 * Register `controltower create-organization`.
 * @param controltower - The controltower command group.
 * @param globals - Resolver for global options from the root program.
 */
export const registerCreateOrganization = (
  controltower: Command,
  globals: () => GlobalOptions
): void => {
  controltower
    .command("create-organization")
    .description(
      "Create an AWS Organization (FeatureSet=ALL) if the account is not already in one"
    )
    .action(async () => {
      await runAction(async () => {
        await handleCreateOrganization(globals());
      });
    });
};
