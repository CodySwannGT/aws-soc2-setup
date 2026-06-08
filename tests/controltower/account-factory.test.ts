import {
  DescribeProductCommand,
  DescribeRecordCommand,
  ListPortfoliosCommand,
  ListProvisioningArtifactsCommand,
  ProvisionProductCommand,
  SearchProductsAsAdminCommand,
  ServiceCatalogClient,
} from "@aws-sdk/client-service-catalog";
import { mockClient } from "aws-sdk-client-mock";
import { beforeEach, describe, expect, it } from "vitest";

import {
  getProvisionedAccountId,
  getRecordStatus,
  provisionAccount,
  resolveAccountFactoryProductId,
  resolveProvisioningArtifactId,
} from "../../src/controltower/account-factory.js";
import { CliError } from "../../src/lib/errors.js";

const scMock = mockClient(ServiceCatalogClient);

const CTX = { region: "us-east-1" };
const PORTFOLIO_NAME = "AWS Control Tower Account Factory Portfolio";
const PRODUCT_NAME = "AWS Control Tower Account Factory";
const PRODUCT_ID = "prod-123";
const ARTIFACT_ID = "pa-123";
const RECORD_ID = "rec-123";

const params = {
  accountName: "Production",
  accountEmail: "prod@example.com",
  ssoEmail: "prod@example.com",
  ssoFirstName: "Admin",
  ssoLastName: "User",
  ouName: "Workloads",
};

describe("controltower/account-factory", () => {
  beforeEach(() => {
    scMock.reset();
  });

  it("resolveAccountFactoryProductId finds the product via admin search", async () => {
    scMock.on(ListPortfoliosCommand).resolves({
      PortfolioDetails: [{ Id: "port-1", DisplayName: PORTFOLIO_NAME }],
    });
    scMock.on(SearchProductsAsAdminCommand).resolves({
      ProductViewDetails: [
        { ProductViewSummary: { Name: PRODUCT_NAME, ProductId: PRODUCT_ID } },
      ],
    });
    await expect(resolveAccountFactoryProductId(CTX)).resolves.toBe(PRODUCT_ID);
  });

  it("resolveAccountFactoryProductId throws when nothing matches", async () => {
    scMock.on(ListPortfoliosCommand).resolves({ PortfolioDetails: [] });
    scMock
      .on(SearchProductsAsAdminCommand)
      .resolves({ ProductViewDetails: [] });
    await expect(resolveAccountFactoryProductId(CTX)).rejects.toBeInstanceOf(
      CliError
    );
  });

  it("resolveProvisioningArtifactId uses describe-product", async () => {
    scMock
      .on(DescribeProductCommand)
      .resolves({ ProvisioningArtifacts: [{ Id: ARTIFACT_ID }] });
    await expect(resolveProvisioningArtifactId(CTX, PRODUCT_ID)).resolves.toBe(
      ARTIFACT_ID
    );
  });

  it("resolveProvisioningArtifactId falls back to list", async () => {
    scMock.on(DescribeProductCommand).resolves({ ProvisioningArtifacts: [] });
    scMock
      .on(ListProvisioningArtifactsCommand)
      .resolves({ ProvisioningArtifactDetails: [{ Id: ARTIFACT_ID }] });
    await expect(resolveProvisioningArtifactId(CTX, PRODUCT_ID)).resolves.toBe(
      ARTIFACT_ID
    );
  });

  it("provisionAccount returns the product and record ids", async () => {
    scMock.on(ListPortfoliosCommand).resolves({
      PortfolioDetails: [{ Id: "port-1", DisplayName: PORTFOLIO_NAME }],
    });
    scMock.on(SearchProductsAsAdminCommand).resolves({
      ProductViewDetails: [
        { ProductViewSummary: { Name: PRODUCT_NAME, ProductId: PRODUCT_ID } },
      ],
    });
    scMock
      .on(DescribeProductCommand)
      .resolves({ ProvisioningArtifacts: [{ Id: ARTIFACT_ID }] });
    scMock.on(ProvisionProductCommand).resolves({
      RecordDetail: { ProvisionedProductId: "pp-1", RecordId: RECORD_ID },
    });
    await expect(provisionAccount(CTX, params)).resolves.toEqual({
      provisionedProductId: "pp-1",
      recordId: RECORD_ID,
    });
  });

  it("getRecordStatus returns the record status", async () => {
    scMock
      .on(DescribeRecordCommand)
      .resolves({ RecordDetail: { Status: "SUCCEEDED" } });
    await expect(getRecordStatus(CTX, RECORD_ID)).resolves.toBe("SUCCEEDED");
  });

  it("getProvisionedAccountId reads the AccountId output", async () => {
    scMock.on(DescribeRecordCommand).resolves({
      RecordOutputs: [{ OutputKey: "AccountId", OutputValue: "123456789012" }],
    });
    await expect(getProvisionedAccountId(CTX, RECORD_ID)).resolves.toBe(
      "123456789012"
    );
  });
});
