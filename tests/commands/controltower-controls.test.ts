import {
  ControlCatalogClient,
  ListControlsCommand,
} from "@aws-sdk/client-controlcatalog";
import {
  ControlTowerClient,
  EnableControlCommand,
  ValidationException,
} from "@aws-sdk/client-controltower";
import {
  DescribeOrganizationCommand,
  OrganizationsClient,
} from "@aws-sdk/client-organizations";
import {
  BatchEnableStandardsCommand,
  DescribeStandardsCommand,
  EnableSecurityHubCommand,
  SecurityHubClient,
} from "@aws-sdk/client-securityhub";
import { GetCallerIdentityCommand, STSClient } from "@aws-sdk/client-sts";
import { mockClient } from "aws-sdk-client-mock";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { handleEnableControls } from "../../src/commands/controltower-controls.js";
import type { GlobalOptions } from "../../src/lib/config.js";
import { CliError } from "../../src/lib/errors.js";
import { buildProgram } from "../../src/program.js";

const stsMock = mockClient(STSClient);
const orgMock = mockClient(OrganizationsClient);
const ctMock = mockClient(ControlTowerClient);
const hubMock = mockClient(SecurityHubClient);
const catalogMock = mockClient(ControlCatalogClient);

const OU = "ou-abcd-12345678";

const globals = (over: Partial<GlobalOptions> = {}): GlobalOptions => ({
  region: "us-east-1",
  dryRun: false,
  yes: false,
  ...over,
});

const options = (over: Record<string, unknown> = {}) => ({
  ou: OU,
  soc2Type: "type1",
  baseline: "minimal",
  ...over,
});

const primeIdentityAndOrg = (): void => {
  stsMock.on(GetCallerIdentityCommand).resolves({
    Account: "123456789012",
    Arn: "arn:aws:iam::123456789012:user/admin",
    UserId: "AIDA",
  });
  orgMock
    .on(DescribeOrganizationCommand)
    .resolves({ Organization: { Id: "o-abc" } });
};

describe("handleEnableControls", () => {
  beforeEach(() => {
    stsMock.reset();
    orgMock.reset();
    ctMock.reset();
    hubMock.reset();
    catalogMock.reset();
    catalogMock.on(ListControlsCommand).resolves({
      Controls: [{ Arn: "arn:aws:controlcatalog:::control/opaque" } as never],
    });
    primeIdentityAndOrg();
    vi.spyOn(process.stdout, "write").mockReturnValue(true);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("rejects an invalid SOC 2 type", async () => {
    await expect(
      handleEnableControls(globals(), options({ soc2Type: "type3" }))
    ).rejects.toBeInstanceOf(CliError);
  });

  it("rejects an invalid baseline", async () => {
    await expect(
      handleEnableControls(globals(), options({ baseline: "extreme" }))
    ).rejects.toBeInstanceOf(CliError);
  });

  it("makes no AWS calls under --dry-run", async () => {
    await handleEnableControls(globals({ dryRun: true }), options());
    expect(ctMock.commandCalls(EnableControlCommand)).toHaveLength(0);
  });

  it("enables the selected controls", async () => {
    ctMock.on(EnableControlCommand).resolves({});
    await handleEnableControls(globals(), options());
    expect(ctMock.commandCalls(EnableControlCommand).length).toBeGreaterThan(0);
  });

  it("reports landing-zone enforced controls separately from failures", async () => {
    const writes: string[] = [];
    vi.spyOn(process.stdout, "write").mockImplementation(chunk => {
      writes.push(String(chunk));
      return true;
    });
    ctMock.on(EnableControlCommand).resolves({});

    await handleEnableControls(
      globals(),
      options({ soc2Type: "type2", baseline: "recommended" })
    );

    const output = writes.join("");
    expect(output).toContain("already enforced by the landing zone");
    expect(output).toContain("0 failed");
  });

  it("does not fall back to Security Hub when controls are only enforced", async () => {
    ctMock.on(EnableControlCommand).rejects(
      new ValidationException({
        message: "Control is enforced by default and cannot be enabled",
        $metadata: {},
      })
    );

    await handleEnableControls(globals(), options({ alternative: true }));

    expect(hubMock.commandCalls(EnableSecurityHubCommand)).toHaveLength(0);
  });

  it("falls back to Security Hub when all controls fail and -a is set", async () => {
    ctMock.on(EnableControlCommand).rejects(new Error("invalid"));
    hubMock.on(EnableSecurityHubCommand).resolves({});
    hubMock.on(DescribeStandardsCommand).resolves({
      Standards: [
        {
          Name: "AWS Foundational Security Best Practices v1.0.0",
          StandardsArn: "arn:std",
        },
      ],
    });
    hubMock.on(BatchEnableStandardsCommand).resolves({});

    await handleEnableControls(globals(), options({ alternative: true }));

    expect(hubMock.commandCalls(EnableSecurityHubCommand)).toHaveLength(1);
  });
});

describe("registerEnableControls", () => {
  it("registers the enable-controls subcommand", () => {
    const ct = buildProgram().commands.find(
      command => command.name() === "controltower"
    );
    const subcommands = (ct?.commands ?? []).map(command => command.name());
    expect(subcommands).toContain("enable-controls");
  });
});
