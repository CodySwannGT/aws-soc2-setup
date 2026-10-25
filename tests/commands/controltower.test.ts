import {
  AWSOrganizationsNotInUseException,
  CreateOrganizationCommand,
  CreateOrganizationalUnitCommand,
  DescribeOrganizationCommand,
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
import { GetCallerIdentityCommand, STSClient } from "@aws-sdk/client-sts";
import { mockClient } from "aws-sdk-client-mock";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { handleCreateOus } from "../../src/commands/controltower.js";
import { handleCreateOrganization } from "../../src/commands/controltower-organization.js";
import { handleProvision } from "../../src/commands/controltower-provision.js";
import type { GlobalOptions } from "../../src/lib/config.js";
import { CliError } from "../../src/lib/errors.js";
import { buildProgram } from "../../src/program.js";

const orgMock = mockClient(OrganizationsClient);
const scMock = mockClient(ServiceCatalogClient);
const stsMock = mockClient(STSClient);

const PORTFOLIO_NAME = "AWS Control Tower Account Factory Portfolio";
const PRODUCT_NAME = "AWS Control Tower Account Factory";
const EMAIL = "prod@example.com";
const ORG_ID = "o-abcdef1234";
const MANAGEMENT_ACCOUNT = "111122223333";

const globals = (over: Partial<GlobalOptions> = {}): GlobalOptions => ({
  region: "us-east-1",
  dryRun: false,
  yes: false,
  ...over,
});

const instantDelay = (): Promise<void> => Promise.resolve();

const DRY_RUN_NO_AWS = "makes no AWS calls under --dry-run";

describe("handleCreateOrganization", () => {
  beforeEach(() => {
    orgMock.reset();
    vi.spyOn(process.stdout, "write").mockReturnValue(true);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it(DRY_RUN_NO_AWS, async () => {
    await handleCreateOrganization(globals({ dryRun: true }));
    expect(orgMock.commandCalls(DescribeOrganizationCommand)).toHaveLength(0);
    expect(orgMock.commandCalls(CreateOrganizationCommand)).toHaveLength(0);
  });

  it("creates an organization when none exists", async () => {
    orgMock.on(DescribeOrganizationCommand).rejects(
      new AWSOrganizationsNotInUseException({
        message: "not in use",
        $metadata: {},
      })
    );
    orgMock.on(CreateOrganizationCommand).resolves({
      Organization: {
        Id: ORG_ID,
        MasterAccountId: MANAGEMENT_ACCOUNT,
        FeatureSet: "ALL",
      },
    });
    await handleCreateOrganization(globals());
    expect(orgMock.commandCalls(CreateOrganizationCommand)).toHaveLength(1);
  });

  it("reports an existing organization without creating", async () => {
    orgMock.on(DescribeOrganizationCommand).resolves({
      Organization: { Id: ORG_ID, MasterAccountId: MANAGEMENT_ACCOUNT },
    });
    await handleCreateOrganization(globals());
    expect(orgMock.commandCalls(CreateOrganizationCommand)).toHaveLength(0);
  });
});

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

  it(DRY_RUN_NO_AWS, async () => {
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

const SSO_CALLER_ARN =
  "arn:aws:sts::111122223333:assumed-role/AWSReservedSSO_AdministratorAccess_0123abcd/cody.swann@example.com";

const callerIs = (arn: string): void => {
  stsMock.on(GetCallerIdentityCommand).resolves({
    Account: MANAGEMENT_ACCOUNT,
    Arn: arn,
    UserId: "AROAEXAMPLE:session",
  });
};

const primeAccountFactory = (): void => {
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
};

const provisionedParam = (key: string): string | undefined =>
  scMock
    .commandCalls(ProvisionProductCommand)[0]
    ?.args[0].input.ProvisioningParameters?.find(param => param.Key === key)
    ?.Value;

describe("handleProvision SSO user", () => {
  beforeEach(() => {
    scMock.reset();
    stsMock.reset();
    primeAccountFactory();
    vi.spyOn(process.stdout, "write").mockReturnValue(true);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("defaults to the caller's Identity Center user", async () => {
    callerIs(SSO_CALLER_ARN);

    await handleProvision(globals(), {
      name: "Prod",
      email: EMAIL,
      ou: "Workloads",
    });

    expect(provisionedParam("SSOUserEmail")).toBe("cody.swann@example.com");
    expect(provisionedParam("SSOUserFirstName")).toBe("Cody");
    expect(provisionedParam("SSOUserLastName")).toBe("Swann");
  });

  it("uses an explicit --sso-email without looking up the caller", async () => {
    await handleProvision(globals(), {
      name: "Prod",
      email: EMAIL,
      ou: "Workloads",
      ssoEmail: "ops@example.com",
      first: "Ops",
      last: "Team",
    });

    expect(stsMock.commandCalls(GetCallerIdentityCommand)).toHaveLength(0);
    expect(provisionedParam("SSOUserEmail")).toBe("ops@example.com");
    expect(provisionedParam("SSOUserFirstName")).toBe("Ops");
  });

  it("requires --sso-email when the caller is not an SSO session", async () => {
    callerIs("arn:aws:iam::111122223333:user/admin");

    await expect(
      handleProvision(globals(), {
        name: "Prod",
        email: EMAIL,
        ou: "Workloads",
      })
    ).rejects.toThrow(/--sso-email/);
    expect(scMock.commandCalls(ProvisionProductCommand)).toHaveLength(0);
  });

  it("requires --sso-email when the SSO session name is not an email", async () => {
    callerIs(
      "arn:aws:sts::111122223333:assumed-role/AWSReservedSSO_Admin_0123abcd/cody"
    );

    await expect(
      handleProvision(globals(), {
        name: "Prod",
        email: EMAIL,
        ou: "Workloads",
      })
    ).rejects.toThrow(/--sso-email/);
  });

  it("refuses to use the account root email as the SSO user", async () => {
    await expect(
      handleProvision(globals(), {
        name: "Prod",
        email: EMAIL,
        ou: "Workloads",
        ssoEmail: EMAIL.toUpperCase(),
      })
    ).rejects.toThrow(/root email/);
    expect(scMock.commandCalls(ProvisionProductCommand)).toHaveLength(0);
  });
});

describe("handleProvision", () => {
  beforeEach(() => {
    scMock.reset();
    stsMock.reset();
    callerIs(SSO_CALLER_ARN);
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

  it(DRY_RUN_NO_AWS, async () => {
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
      expect.arrayContaining([
        "create-organization",
        "create-ous",
        "register-ou",
        "provision-account",
      ])
    );
  });
});
