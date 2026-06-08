import { randomUUID } from "node:crypto";

import {
  DescribeProductCommand,
  DescribeRecordCommand,
  ListPortfoliosCommand,
  ListProvisioningArtifactsCommand,
  ProvisionProductCommand,
  SearchProductsAsAdminCommand,
  SearchProductsCommand,
  ServiceCatalogClient,
} from "@aws-sdk/client-service-catalog";

import { buildClientConfig } from "../lib/aws.js";
import { CliError } from "../lib/errors.js";

import type { ControlTowerContext } from "./organizations.js";

const PORTFOLIO_NAME = "AWS Control Tower Account Factory Portfolio";
const PRODUCT_NAME = "AWS Control Tower Account Factory";

const scClient = (context: ControlTowerContext): ServiceCatalogClient =>
  new ServiceCatalogClient(buildClientConfig(context));

/** Parameters for provisioning a new account through Account Factory. */
export interface ProvisionAccountParams {
  accountName: string;
  accountEmail: string;
  ssoEmail: string;
  ssoFirstName: string;
  ssoLastName: string;
  ouName: string;
}

/** Identifiers returned after initiating a provisioning request. */
export interface ProvisionResult {
  provisionedProductId: string;
  recordId: string;
}

const findPortfolioId = async (
  context: ControlTowerContext
): Promise<string | undefined> => {
  const result = await scClient(context).send(new ListPortfoliosCommand({}));
  return result.PortfolioDetails?.find(
    portfolio => portfolio.DisplayName === PORTFOLIO_NAME
  )?.Id;
};

const findProductIdAsAdmin = async (
  context: ControlTowerContext,
  portfolioId: string
): Promise<string | undefined> => {
  try {
    const result = await scClient(context).send(
      new SearchProductsAsAdminCommand({ PortfolioId: portfolioId })
    );
    return result.ProductViewDetails?.find(
      view => view.ProductViewSummary?.Name === PRODUCT_NAME
    )?.ProductViewSummary?.ProductId;
  } catch {
    return undefined;
  }
};

const findProductIdByName = async (
  context: ControlTowerContext
): Promise<string | undefined> => {
  try {
    const result = await scClient(context).send(
      new SearchProductsCommand({ Filters: { FullTextSearch: [PRODUCT_NAME] } })
    );
    return result.ProductViewSummaries?.find(view => view.Name === PRODUCT_NAME)
      ?.ProductId;
  } catch {
    return undefined;
  }
};

/**
 * Resolve the Account Factory product id, trying the admin search first then a
 * full-text search fallback.
 * @param context - AWS region/profile context.
 * @returns The product id.
 * @throws {CliError} If the Account Factory product cannot be found.
 */
export const resolveAccountFactoryProductId = async (
  context: ControlTowerContext
): Promise<string> => {
  const portfolioId = await findPortfolioId(context);
  const productId =
    (portfolioId
      ? await findProductIdAsAdmin(context, portfolioId)
      : undefined) ?? (await findProductIdByName(context));
  if (!productId) {
    throw new CliError(
      "Could not find the Account Factory product. Ensure Control Tower is set up."
    );
  }
  return productId;
};

const artifactFromDescribe = async (
  context: ControlTowerContext,
  productId: string
): Promise<string | undefined> => {
  try {
    const result = await scClient(context).send(
      new DescribeProductCommand({ Id: productId })
    );
    return result.ProvisioningArtifacts?.[0]?.Id;
  } catch {
    return undefined;
  }
};

const artifactFromList = async (
  context: ControlTowerContext,
  productId: string
): Promise<string | undefined> => {
  try {
    const result = await scClient(context).send(
      new ListProvisioningArtifactsCommand({ ProductId: productId })
    );
    return result.ProvisioningArtifactDetails?.[0]?.Id;
  } catch {
    return undefined;
  }
};

/**
 * Resolve the latest provisioning artifact id for the product.
 * @param context - AWS region/profile context.
 * @param productId - The Account Factory product id.
 * @returns The provisioning artifact id.
 * @throws {CliError} If no artifact can be found.
 */
export const resolveProvisioningArtifactId = async (
  context: ControlTowerContext,
  productId: string
): Promise<string> => {
  const artifactId =
    (await artifactFromDescribe(context, productId)) ??
    (await artifactFromList(context, productId));
  if (!artifactId) {
    throw new CliError(
      "Could not find a provisioning artifact for the Account Factory product."
    );
  }
  return artifactId;
};

/**
 * Provision a new account through Account Factory.
 * @param context - AWS region/profile context.
 * @param params - Account/SSO/OU details.
 * @returns The provisioned product and record ids.
 * @throws {CliError} If provisioning returns no product id.
 */
export const provisionAccount = async (
  context: ControlTowerContext,
  params: ProvisionAccountParams
): Promise<ProvisionResult> => {
  const productId = await resolveAccountFactoryProductId(context);
  const artifactId = await resolveProvisioningArtifactId(context, productId);
  const result = await scClient(context).send(
    new ProvisionProductCommand({
      ProductId: productId,
      ProvisioningArtifactId: artifactId,
      ProvisionToken: randomUUID(),
      ProvisionedProductName: params.accountName,
      ProvisioningParameters: [
        { Key: "AccountName", Value: params.accountName },
        { Key: "AccountEmail", Value: params.accountEmail },
        { Key: "SSOUserFirstName", Value: params.ssoFirstName },
        { Key: "SSOUserLastName", Value: params.ssoLastName },
        { Key: "SSOUserEmail", Value: params.ssoEmail },
        { Key: "ManagedOrganizationalUnit", Value: params.ouName },
      ],
    })
  );
  const provisionedProductId = result.RecordDetail?.ProvisionedProductId;
  const recordId = result.RecordDetail?.RecordId;
  if (!provisionedProductId || !recordId) {
    throw new CliError("Failed to provision the account.");
  }
  return { provisionedProductId, recordId };
};

/**
 * Fetch the status of a provisioning record.
 * @param context - AWS region/profile context.
 * @param recordId - The provisioning record id.
 * @returns The record status (e.g. SUCCEEDED, FAILED), if available.
 */
export const getRecordStatus = async (
  context: ControlTowerContext,
  recordId: string
): Promise<string | undefined> => {
  const result = await scClient(context).send(
    new DescribeRecordCommand({ Id: recordId })
  );
  return result.RecordDetail?.Status;
};

/**
 * Extract the provisioned account id from a completed record's outputs.
 * @param context - AWS region/profile context.
 * @param recordId - The provisioning record id.
 * @returns The new account id, if present.
 */
export const getProvisionedAccountId = async (
  context: ControlTowerContext,
  recordId: string
): Promise<string | undefined> => {
  const result = await scClient(context).send(
    new DescribeRecordCommand({ Id: recordId })
  );
  return result.RecordOutputs?.find(output => output.OutputKey === "AccountId")
    ?.OutputValue;
};
