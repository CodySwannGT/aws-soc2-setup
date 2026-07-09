import {
  AlreadyInOrganizationException,
  AWSOrganizationsNotInUseException,
  CreateOrganizationCommand,
  CreateOrganizationalUnitCommand,
  DescribeOrganizationCommand,
  ListOrganizationalUnitsForParentCommand,
  ListRootsCommand,
  OrganizationsClient,
} from "@aws-sdk/client-organizations";
import { mockClient } from "aws-sdk-client-mock";
import { beforeEach, describe, expect, it } from "vitest";

import {
  describeOrganization,
  ensureOrganization,
  ensureOu,
  findOuId,
  getRootId,
  ORGANIZATION_FEATURE_SET,
} from "../../src/controltower/organizations.js";
import { CliError } from "../../src/lib/errors.js";

const orgMock = mockClient(OrganizationsClient);

const CTX = { region: "us-east-1" };
const ROOT_ID = "r-abcd";
const OU_ID = "ou-abcd-12345678";
const OU_NAME = "Workloads";
const ORG_ID = "o-abcdef1234";
const ACCOUNT = "111122223333";
const NOT_IN_USE = "not in use";

const organizationsNotInUse = (): AWSOrganizationsNotInUseException =>
  new AWSOrganizationsNotInUseException({
    message: NOT_IN_USE,
    $metadata: {},
  });

describe("controltower/organizations", () => {
  beforeEach(() => {
    orgMock.reset();
  });

  it("describeOrganization returns undefined when Organizations is not in use", async () => {
    orgMock.on(DescribeOrganizationCommand).rejects(organizationsNotInUse());
    await expect(describeOrganization(CTX)).resolves.toBeUndefined();
  });

  it("ensureOrganization reuses an existing organization", async () => {
    orgMock.on(DescribeOrganizationCommand).resolves({
      Organization: {
        Id: ORG_ID,
        MasterAccountId: ACCOUNT,
        FeatureSet: ORGANIZATION_FEATURE_SET,
      },
    });
    await expect(ensureOrganization(CTX)).resolves.toEqual({
      created: false,
      organization: {
        id: ORG_ID,
        managementAccountId: ACCOUNT,
        featureSet: ORGANIZATION_FEATURE_SET,
      },
    });
    expect(orgMock.commandCalls(CreateOrganizationCommand)).toHaveLength(0);
  });

  it("ensureOrganization creates an organization with FeatureSet ALL", async () => {
    orgMock.on(DescribeOrganizationCommand).rejects(organizationsNotInUse());
    orgMock.on(CreateOrganizationCommand).resolves({
      Organization: {
        Id: ORG_ID,
        MasterAccountId: ACCOUNT,
        FeatureSet: ORGANIZATION_FEATURE_SET,
      },
    });

    await expect(ensureOrganization(CTX)).resolves.toEqual({
      created: true,
      organization: {
        id: ORG_ID,
        managementAccountId: ACCOUNT,
        featureSet: ORGANIZATION_FEATURE_SET,
      },
    });
    const call = orgMock.commandCalls(CreateOrganizationCommand)[0];
    expect(call?.args[0].input.FeatureSet).toBe(ORGANIZATION_FEATURE_SET);
  });

  it("ensureOrganization recovers when create races with AlreadyInOrganization", async () => {
    orgMock
      .on(DescribeOrganizationCommand)
      .rejectsOnce(organizationsNotInUse())
      .resolves({
        Organization: {
          Id: ORG_ID,
          MasterAccountId: ACCOUNT,
          FeatureSet: ORGANIZATION_FEATURE_SET,
        },
      });
    orgMock.on(CreateOrganizationCommand).rejects(
      new AlreadyInOrganizationException({
        message: "already in org",
        $metadata: {},
      })
    );

    await expect(ensureOrganization(CTX)).resolves.toEqual({
      created: false,
      organization: {
        id: ORG_ID,
        managementAccountId: ACCOUNT,
        featureSet: ORGANIZATION_FEATURE_SET,
      },
    });
  });

  it("ensureOrganization throws when create returns no organization", async () => {
    orgMock.on(DescribeOrganizationCommand).rejects(organizationsNotInUse());
    orgMock.on(CreateOrganizationCommand).resolves({});
    await expect(ensureOrganization(CTX)).rejects.toBeInstanceOf(CliError);
  });

  it("getRootId returns the first root id", async () => {
    orgMock.on(ListRootsCommand).resolves({ Roots: [{ Id: ROOT_ID }] });
    await expect(getRootId(CTX)).resolves.toBe(ROOT_ID);
  });

  it("getRootId throws when no root exists", async () => {
    orgMock.on(ListRootsCommand).resolves({ Roots: [] });
    await expect(getRootId(CTX)).rejects.toBeInstanceOf(CliError);
  });

  it("findOuId returns the matching OU id", async () => {
    orgMock.on(ListOrganizationalUnitsForParentCommand).resolves({
      OrganizationalUnits: [{ Id: OU_ID, Name: OU_NAME }],
    });
    await expect(findOuId(CTX, ROOT_ID, OU_NAME)).resolves.toBe(OU_ID);
  });

  it("ensureOu reuses an existing OU", async () => {
    orgMock.on(ListOrganizationalUnitsForParentCommand).resolves({
      OrganizationalUnits: [{ Id: OU_ID, Name: OU_NAME }],
    });
    await expect(
      ensureOu(CTX, ROOT_ID, OU_NAME, "Production")
    ).resolves.toEqual({
      ouId: OU_ID,
      created: false,
    });
    expect(orgMock.commandCalls(CreateOrganizationalUnitCommand)).toHaveLength(
      0
    );
  });

  it("ensureOu creates a missing OU with a purpose tag", async () => {
    orgMock
      .on(ListOrganizationalUnitsForParentCommand)
      .resolves({ OrganizationalUnits: [] });
    orgMock
      .on(CreateOrganizationalUnitCommand)
      .resolves({ OrganizationalUnit: { Id: OU_ID } });
    await expect(
      ensureOu(CTX, ROOT_ID, OU_NAME, "Production")
    ).resolves.toEqual({
      ouId: OU_ID,
      created: true,
    });
    const call = orgMock.commandCalls(CreateOrganizationalUnitCommand)[0];
    expect(call?.args[0].input.Tags?.[0]?.Value).toBe("Production");
  });

  it("ensureOu throws when creation returns no id", async () => {
    orgMock
      .on(ListOrganizationalUnitsForParentCommand)
      .resolves({ OrganizationalUnits: [] });
    orgMock.on(CreateOrganizationalUnitCommand).resolves({});
    await expect(
      ensureOu(CTX, ROOT_ID, OU_NAME, "Production")
    ).rejects.toBeInstanceOf(CliError);
  });
});
