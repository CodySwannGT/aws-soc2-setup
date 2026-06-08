import {
  CreateOrganizationalUnitCommand,
  ListOrganizationalUnitsForParentCommand,
  ListRootsCommand,
  OrganizationsClient,
} from "@aws-sdk/client-organizations";
import { mockClient } from "aws-sdk-client-mock";
import { beforeEach, describe, expect, it } from "vitest";

import {
  ensureOu,
  findOuId,
  getRootId,
} from "../../src/controltower/organizations.js";
import { CliError } from "../../src/lib/errors.js";

const orgMock = mockClient(OrganizationsClient);

const CTX = { region: "us-east-1" };
const ROOT_ID = "r-abcd";
const OU_ID = "ou-abcd-12345678";
const OU_NAME = "Workloads";

describe("controltower/organizations", () => {
  beforeEach(() => {
    orgMock.reset();
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
