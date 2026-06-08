import {
  CreateOrganizationalUnitCommand,
  ListOrganizationalUnitsForParentCommand,
  ListRootsCommand,
  OrganizationsClient,
} from "@aws-sdk/client-organizations";
import {
  DescribeProductCommand,
  DescribeRecordCommand,
  ListPortfoliosCommand,
  ProvisionProductCommand,
  SearchProductsAsAdminCommand,
  ServiceCatalogClient,
} from "@aws-sdk/client-service-catalog";
import { mockClient } from "aws-sdk-client-mock";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { handleCreateOus } from "../../src/commands/controltower.js";
import { handleProvision } from "../../src/commands/controltower-provision.js";
import type { GlobalOptions } from "../../src/lib/config.js";
import { CliError } from "../../src/lib/errors.js";
import { buildProgram } from "../../src/program.js";

const orgMock = mockClient(OrganizationsClient);
const scMock = mockClient(ServiceCatalogClient);

const PORTFOLIO_NAME = "AWS Control Tower Account Factory Portfolio";
const PRODUCT_NAME = "AWS Control Tower Account Factory";
const EMAIL = "prod@example.com";

const globals = (over: Partial<GlobalOptions> = {}): GlobalOptions => ({
  region: "us-east-1",
  dryRun: false,
  yes: false,
  ...over,
});

const instantDelay = (): Promise<void> => Promise.resolve();

describe("handleCreateOus", () => {
  beforeEach(() => {
    orgMock.reset();
    vi.spyOn(process.stdout, "write").mockReturnValue(true);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("throws when no OUs are selected", async () => {
    await expect(handleCreateOus(globals(), {})).rejects.toBeInstanceOf(
      CliError
    );
  });

  it("makes no AWS calls under --dry-run", async () => {
    await handleCreateOus(globals({ dryRun: true }), { all: true });
    expect(orgMock.commandCalls(ListRootsCommand)).toHaveLength(0);
  });

  it("creates all selected OUs", async () => {
    orgMock.on(ListRootsCommand).resolves({ Roots: [{ Id: "r-abcd" }] });
    orgMock
      .on(ListOrganizationalUnitsForParentCommand)
      .resolves({ OrganizationalUnits: [] });
    orgMock
      .on(CreateOrganizationalUnitCommand)
      .resolves({ OrganizationalUnit: { Id: "ou-1" } });
    await handleCreateOus(globals(), { all: true });
    expect(orgMock.commandCalls(CreateOrganizationalUnitCommand)).toHaveLength(
      3
    );
  });
});

describe("handleProvision", () => {
  beforeEach(() => {
    scMock.reset();
    vi.spyOn(process.stdout, "write").mockReturnValue(true);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("rejects an invalid email", async () => {
    await expect(
      handleProvision(globals(), {
        name: "Prod",
        email: "not-an-email",
        ou: "Workloads",
        first: "Admin",
        last: "User",
      })
    ).rejects.toBeInstanceOf(CliError);
  });

  it("makes no AWS calls under --dry-run", async () => {
    await handleProvision(globals({ dryRun: true }), {
      name: "Prod",
      email: EMAIL,
      ou: "Workloads",
      first: "Admin",
      last: "User",
    });
    expect(scMock.commandCalls(ProvisionProductCommand)).toHaveLength(0);
  });

  it("provisions and waits for completion", async () => {
    scMock.on(ListPortfoliosCommand).resolves({
      PortfolioDetails: [{ Id: "port-1", DisplayName: PORTFOLIO_NAME }],
    });
    scMock.on(SearchProductsAsAdminCommand).resolves({
      ProductViewDetails: [
        { ProductViewSummary: { Name: PRODUCT_NAME, ProductId: "prod-1" } },
      ],
    });
    scMock
      .on(DescribeProductCommand)
      .resolves({ ProvisioningArtifacts: [{ Id: "pa-1" }] });
    scMock.on(ProvisionProductCommand).resolves({
      RecordDetail: { ProvisionedProductId: "pp-1", RecordId: "rec-1" },
    });
    scMock.on(DescribeRecordCommand).resolves({
      RecordDetail: { Status: "SUCCEEDED" },
      RecordOutputs: [{ OutputKey: "AccountId", OutputValue: "123456789012" }],
    });

    await handleProvision(
      globals(),
      {
        name: "Prod",
        email: EMAIL,
        ou: "Workloads",
        first: "Admin",
        last: "User",
        wait: true,
      },
      instantDelay
    );

    expect(scMock.commandCalls(ProvisionProductCommand)).toHaveLength(1);
  });
});

describe("registerControlTower", () => {
  it("registers the controltower command group", () => {
    const ct = buildProgram().commands.find(
      command => command.name() === "controltower"
    );
    const subcommands = (ct?.commands ?? []).map(command => command.name());
    expect(subcommands).toEqual(
      expect.arrayContaining(["create-ous", "provision-account"])
    );
  });
});
