import {
  DescribeOrganizationCommand,
  OrganizationsClient,
} from "@aws-sdk/client-organizations";
import { GetCallerIdentityCommand, STSClient } from "@aws-sdk/client-sts";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { handleRegisterOu } from "../../src/commands/controltower-register-ou.js";
import * as baselines from "../../src/controltower/baselines.js";
import type { GlobalOptions } from "../../src/lib/config.js";
import { CliError } from "../../src/lib/errors.js";
import { buildProgram } from "../../src/program.js";
import { mockClient } from "aws-sdk-client-mock";

const orgMock = mockClient(OrganizationsClient);
const stsMock = mockClient(STSClient);

const OU_ID = "ou-abcd-12345678";
const OU_ARN = `arn:aws:organizations::111122223333:ou/o-abcdef1234/${OU_ID}`;
const ACCOUNT = "111122223333";
const ORG_ID = "o-abcdef1234";

const globals = (over: Partial<GlobalOptions> = {}): GlobalOptions => ({
  region: "us-east-1",
  dryRun: false,
  yes: false,
  ...over,
});

describe("handleRegisterOu", () => {
  beforeEach(() => {
    orgMock.reset();
    stsMock.reset();
    vi.spyOn(process.stdout, "write").mockReturnValue(true);
    stsMock.on(GetCallerIdentityCommand).resolves({
      Account: ACCOUNT,
      Arn: `arn:aws:iam::${ACCOUNT}:user/admin`,
      UserId: "AIDAEXAMPLE",
    });
    orgMock.on(DescribeOrganizationCommand).resolves({
      Organization: { Id: ORG_ID, MasterAccountId: ACCOUNT },
    });
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("rejects an invalid OU id", async () => {
    await expect(
      handleRegisterOu(globals(), { ou: "not-an-ou" })
    ).rejects.toBeInstanceOf(CliError);
  });

  it("makes no registration calls under --dry-run", async () => {
    const register = vi
      .spyOn(baselines, "registerOrganizationalUnit")
      .mockResolvedValue({
        ouArn: OU_ARN,
        enabledBaselineArn: "arn:enabled",
        alreadyRegistered: false,
      });
    await handleRegisterOu(globals({ dryRun: true }), { ou: OU_ID });
    expect(register).not.toHaveBeenCalled();
  });

  it("registers an OU and optionally waits", async () => {
    vi.spyOn(baselines, "registerOrganizationalUnit").mockResolvedValue({
      ouArn: OU_ARN,
      enabledBaselineArn:
        "arn:aws:controltower:us-east-1:111122223333:enabledbaseline/x",
      operationIdentifier: "op-1",
      alreadyRegistered: false,
    });
    const wait = vi.fn().mockResolvedValue("SUCCEEDED");

    await handleRegisterOu(globals(), { ou: OU_ID, wait: true }, wait);

    expect(baselines.registerOrganizationalUnit).toHaveBeenCalledWith(
      expect.anything(),
      OU_ARN,
      "5.0"
    );
    expect(wait).toHaveBeenCalledWith(expect.anything(), "op-1");
  });

  it("reports when the OU is already registered", async () => {
    vi.spyOn(baselines, "registerOrganizationalUnit").mockResolvedValue({
      ouArn: OU_ARN,
      enabledBaselineArn: "arn:enabled",
      alreadyRegistered: true,
    });
    const wait = vi.fn();
    await handleRegisterOu(globals(), { ou: OU_ID, wait: true }, wait);
    expect(wait).not.toHaveBeenCalled();
  });
});

describe("registerRegisterOu wiring", () => {
  it("registers register-ou on the controltower group", () => {
    const ct = buildProgram().commands.find(
      command => command.name() === "controltower"
    );
    const subcommands = (ct?.commands ?? []).map(command => command.name());
    expect(subcommands).toContain("register-ou");
  });
});
