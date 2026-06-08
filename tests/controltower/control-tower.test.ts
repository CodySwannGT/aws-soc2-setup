import {
  ControlTowerClient,
  EnableControlCommand,
} from "@aws-sdk/client-controltower";
import {
  DescribeOrganizationCommand,
  ListRootsCommand,
  OrganizationsClient,
} from "@aws-sdk/client-organizations";
import {
  BatchEnableStandardsCommand,
  DescribeStandardsCommand,
  EnableSecurityHubCommand,
  SecurityHubClient,
} from "@aws-sdk/client-securityhub";
import { mockClient } from "aws-sdk-client-mock";
import { beforeEach, describe, expect, it } from "vitest";

import {
  enableControlWithFormats,
  enableSecurityHubFallback,
  getOrganizationId,
} from "../../src/controltower/control-tower.js";
import { CliError } from "../../src/lib/errors.js";

const ctMock = mockClient(ControlTowerClient);
const orgMock = mockClient(OrganizationsClient);
const hubMock = mockClient(SecurityHubClient);

const CTX = { region: "us-east-1" };
const TARGET = "arn:aws:organizations::123456789012:ou/o-abc/ou-abcd-12345678";
const FSBP_NAME = "AWS Foundational Security Best Practices v1.0.0";

describe("controltower/control-tower", () => {
  beforeEach(() => {
    ctMock.reset();
    orgMock.reset();
    hubMock.reset();
  });

  it("getOrganizationId uses describe-organization", async () => {
    orgMock
      .on(DescribeOrganizationCommand)
      .resolves({ Organization: { Id: "o-direct" } });
    await expect(getOrganizationId(CTX)).resolves.toBe("o-direct");
  });

  it("getOrganizationId falls back to the root ARN", async () => {
    orgMock.on(DescribeOrganizationCommand).rejects(new Error("denied"));
    orgMock.on(ListRootsCommand).resolves({
      Roots: [
        { Arn: "arn:aws:organizations::1:root/o-fromroot/r-xyz", Id: "r-xyz" },
      ],
    });
    await expect(getOrganizationId(CTX)).resolves.toBe("o-fromroot");
  });

  it("getOrganizationId throws when nothing resolves", async () => {
    orgMock.on(DescribeOrganizationCommand).rejects(new Error("denied"));
    orgMock.on(ListRootsCommand).rejects(new Error("denied"));
    await expect(getOrganizationId(CTX)).rejects.toBeInstanceOf(CliError);
  });

  it("enableControlWithFormats returns true on the first success", async () => {
    ctMock.on(EnableControlCommand).resolves({});
    await expect(
      enableControlWithFormats(CTX, ["fmt-a", "fmt-b"], TARGET)
    ).resolves.toBe(true);
    expect(ctMock.commandCalls(EnableControlCommand)).toHaveLength(1);
  });

  it("enableControlWithFormats returns false when all formats fail", async () => {
    ctMock.on(EnableControlCommand).rejects(new Error("invalid"));
    await expect(
      enableControlWithFormats(CTX, ["fmt-a", "fmt-b"], TARGET)
    ).resolves.toBe(false);
    expect(ctMock.commandCalls(EnableControlCommand)).toHaveLength(2);
  });

  it("enableSecurityHubFallback enables the hub and FSBP standard", async () => {
    hubMock.on(EnableSecurityHubCommand).resolves({});
    hubMock
      .on(DescribeStandardsCommand)
      .resolves({ Standards: [{ Name: FSBP_NAME, StandardsArn: "arn:std" }] });
    hubMock.on(BatchEnableStandardsCommand).resolves({});
    await expect(enableSecurityHubFallback(CTX)).resolves.toBe(true);
  });

  it("enableSecurityHubFallback returns false when the hub cannot be enabled", async () => {
    hubMock.on(EnableSecurityHubCommand).rejects(new Error("denied"));
    await expect(enableSecurityHubFallback(CTX)).resolves.toBe(false);
  });
});
