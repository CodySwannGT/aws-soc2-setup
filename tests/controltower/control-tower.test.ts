import {
  ControlCatalogClient,
  ListControlsCommand,
} from "@aws-sdk/client-controlcatalog";
import {
  ControlTowerClient,
  EnableControlCommand,
  ResourceNotFoundException,
  ValidationException,
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
  enableSoc2Control,
  getOrganizationId,
  resolveConfigRuleControlArn,
} from "../../src/controltower/control-tower.js";
import { CliError } from "../../src/lib/errors.js";

const ctMock = mockClient(ControlTowerClient);
const orgMock = mockClient(OrganizationsClient);
const hubMock = mockClient(SecurityHubClient);
const catalogMock = mockClient(ControlCatalogClient);

const CTX = { region: "us-east-1" };
const TARGET = "arn:aws:organizations::123456789012:ou/o-abc/ou-abcd-12345678";
const FSBP_NAME = "AWS Foundational Security Best Practices v1.0.0";
const CATALOG_ARN = "arn:aws:controlcatalog:::control/abc123opaque";
const S3_SSE_RULE = "S3_BUCKET_SERVER_SIDE_ENCRYPTION_ENABLED";

const validation = (message: string): ValidationException =>
  new ValidationException({ message, $metadata: {} });

const notFound = (message: string): ResourceNotFoundException =>
  new ResourceNotFoundException({ message, $metadata: {} });

describe("controltower/control-tower", () => {
  beforeEach(() => {
    ctMock.reset();
    orgMock.reset();
    hubMock.reset();
    catalogMock.reset();
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

  it("enableControlWithFormats reports enabled on the first success", async () => {
    ctMock.on(EnableControlCommand).resolves({});
    await expect(
      enableControlWithFormats(CTX, ["fmt-a", "fmt-b"], TARGET)
    ).resolves.toEqual({ status: "enabled" });
    expect(ctMock.commandCalls(EnableControlCommand)).toHaveLength(1);
  });

  it("enableControlWithFormats reports failed with the AWS message", async () => {
    ctMock.on(EnableControlCommand).rejects(new Error("access denied"));
    await expect(
      enableControlWithFormats(CTX, ["fmt-a", "fmt-b"], TARGET)
    ).resolves.toEqual({ status: "failed", reason: "access denied" });
    expect(ctMock.commandCalls(EnableControlCommand)).toHaveLength(2);
  });

  it("enableControlWithFormats treats 'enforced by default' as enforced and stops", async () => {
    ctMock
      .on(EnableControlCommand)
      .rejects(
        validation(
          "Control with ARN arn:aws:controlcatalog:::control/x is enforced by default and cannot be enabled"
        )
      );
    await expect(
      enableControlWithFormats(CTX, ["fmt-a", "fmt-b"], TARGET)
    ).resolves.toEqual({ status: "enforced" });
    expect(ctMock.commandCalls(EnableControlCommand)).toHaveLength(1);
  });

  it("enableControlWithFormats reports not-found when no format resolves", async () => {
    ctMock
      .on(EnableControlCommand)
      .rejects(notFound("The control does not exist"));
    const outcome = await enableControlWithFormats(
      CTX,
      ["fmt-a", "fmt-b"],
      TARGET
    );
    expect(outcome.status).toBe("not-found");
  });

  it("enableControlWithFormats prefers a real failure over not-found", async () => {
    ctMock
      .on(EnableControlCommand)
      .rejectsOnce(notFound("no such control"))
      .rejectsOnce(new Error("throttled"));
    await expect(
      enableControlWithFormats(CTX, ["fmt-a", "fmt-b"], TARGET)
    ).resolves.toEqual({ status: "failed", reason: "throttled" });
  });

  it("resolveConfigRuleControlArn filters the catalog by Config rule id", async () => {
    catalogMock
      .on(ListControlsCommand)
      .resolves({ Controls: [{ Arn: CATALOG_ARN } as never] });
    await expect(resolveConfigRuleControlArn(CTX, S3_SSE_RULE)).resolves.toBe(
      CATALOG_ARN
    );
    expect(
      catalogMock.commandCalls(ListControlsCommand)[0]?.args[0].input.Filter
    ).toEqual({
      Implementations: {
        Types: ["AWS::Config::ConfigRule"],
        Identifiers: [S3_SSE_RULE],
      },
    });
  });

  it("resolveConfigRuleControlArn returns undefined when nothing matches", async () => {
    catalogMock.on(ListControlsCommand).resolves({ Controls: [] });
    await expect(
      resolveConfigRuleControlArn(CTX, S3_SSE_RULE)
    ).resolves.toBeUndefined();
  });

  it("enableSoc2Control skips landing-zone mandatory controls", async () => {
    await expect(
      enableSoc2Control(CTX, "AWS-GR_CONFIG_ENABLED", TARGET)
    ).resolves.toEqual({ status: "enforced" });
    expect(ctMock.commandCalls(EnableControlCommand)).toHaveLength(0);
  });

  it("enableSoc2Control enables a Config-rule control by its catalog ARN", async () => {
    catalogMock
      .on(ListControlsCommand)
      .resolves({ Controls: [{ Arn: CATALOG_ARN } as never] });
    ctMock.on(EnableControlCommand).resolves({});
    await expect(enableSoc2Control(CTX, S3_SSE_RULE, TARGET)).resolves.toEqual({
      status: "enabled",
    });
    expect(
      ctMock.commandCalls(EnableControlCommand)[0]?.args[0].input
        .controlIdentifier
    ).toBe(CATALOG_ARN);
  });

  it("enableSoc2Control reports not-found when the catalog has no match", async () => {
    catalogMock.on(ListControlsCommand).resolves({ Controls: [] });
    const outcome = await enableSoc2Control(CTX, S3_SSE_RULE, TARGET);
    expect(outcome.status).toBe("not-found");
    expect(ctMock.commandCalls(EnableControlCommand)).toHaveLength(0);
  });

  it("enableSoc2Control reports failed, not not-found, when the catalog lookup errors", async () => {
    catalogMock
      .on(ListControlsCommand)
      .rejects(new Error("AccessDeniedException: controlcatalog:ListControls"));
    await expect(enableSoc2Control(CTX, S3_SSE_RULE, TARGET)).resolves.toEqual({
      status: "failed",
      reason: `Control Catalog lookup for AWS Config rule ${S3_SSE_RULE} failed: AccessDeniedException: controlcatalog:ListControls`,
    });
    expect(ctMock.commandCalls(EnableControlCommand)).toHaveLength(0);
  });

  it("enableSoc2Control tries Control Tower formats for legacy controls", async () => {
    ctMock.on(EnableControlCommand).resolves({});
    await enableSoc2Control(CTX, "AWS-GR_ENCRYPTED_VOLUMES", TARGET);
    expect(
      ctMock.commandCalls(EnableControlCommand)[0]?.args[0].input
        .controlIdentifier
    ).toBe("arn:aws:controltower:us-east-1::control/AWS-GR_ENCRYPTED_VOLUMES");
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
