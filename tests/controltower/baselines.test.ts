import {
  ControlTowerClient,
  EnableBaselineCommand,
  GetBaselineOperationCommand,
  ListBaselinesCommand,
  ListEnabledBaselinesCommand,
} from "@aws-sdk/client-controltower";
import { mockClient } from "aws-sdk-client-mock";
import { beforeEach, describe, expect, it } from "vitest";

import {
  CONTROL_TOWER_BASELINE_NAME,
  findBaselineArn,
  findIdentityCenterEnabledBaselineArn,
  findRegisteredOuBaseline,
  IDENTITY_CENTER_BASELINE_NAME,
  IDENTITY_CENTER_BASELINE_PARAM,
  registerOrganizationalUnit,
  waitForBaselineOperation,
} from "../../src/controltower/baselines.js";
import { CliError } from "../../src/lib/errors.js";

const ctMock = mockClient(ControlTowerClient);

const CTX = { region: "us-east-1" };
const CT_BASELINE_ARN = "arn:aws:controltower:us-east-1::baseline/ct";
const IC_BASELINE_ARN = "arn:aws:controltower:us-east-1::baseline/ic";
const IC_ENABLED_ARN =
  "arn:aws:controltower:us-east-1:111122223333:enabledbaseline/ic-enabled";
const OU_ARN =
  "arn:aws:organizations::111122223333:ou/o-abcdef1234/ou-abcd-12345678";
const ENABLED_ARN =
  "arn:aws:controltower:us-east-1:111122223333:enabledbaseline/ou-enabled";

describe("controltower/baselines", () => {
  beforeEach(() => {
    ctMock.reset();
  });

  it("findBaselineArn resolves a baseline by name", async () => {
    ctMock.on(ListBaselinesCommand).resolves({
      baselines: [
        { arn: IC_BASELINE_ARN, name: IDENTITY_CENTER_BASELINE_NAME },
        { arn: CT_BASELINE_ARN, name: CONTROL_TOWER_BASELINE_NAME },
      ],
    });
    await expect(
      findBaselineArn(CTX, CONTROL_TOWER_BASELINE_NAME)
    ).resolves.toBe(CT_BASELINE_ARN);
  });

  it("findBaselineArn throws when the baseline is missing", async () => {
    ctMock.on(ListBaselinesCommand).resolves({ baselines: [] });
    await expect(
      findBaselineArn(CTX, CONTROL_TOWER_BASELINE_NAME)
    ).rejects.toBeInstanceOf(CliError);
  });

  it("findIdentityCenterEnabledBaselineArn returns the enabled IC baseline", async () => {
    ctMock.on(ListBaselinesCommand).resolves({
      baselines: [
        { arn: IC_BASELINE_ARN, name: IDENTITY_CENTER_BASELINE_NAME },
      ],
    });
    ctMock.on(ListEnabledBaselinesCommand).resolves({
      enabledBaselines: [
        {
          arn: IC_ENABLED_ARN,
          baselineIdentifier: IC_BASELINE_ARN,
          targetIdentifier:
            "arn:aws:organizations::111122223333:account/o-abcdef1234/111122223333",
        },
      ],
    });
    await expect(findIdentityCenterEnabledBaselineArn(CTX)).resolves.toBe(
      IC_ENABLED_ARN
    );
  });

  it("findIdentityCenterEnabledBaselineArn returns undefined when IC baseline is absent", async () => {
    ctMock.on(ListBaselinesCommand).resolves({ baselines: [] });
    await expect(findIdentityCenterEnabledBaselineArn(CTX)).resolves.toBe(
      undefined
    );
  });

  it("findRegisteredOuBaseline returns an existing OU registration", async () => {
    ctMock.on(ListBaselinesCommand).resolves({
      baselines: [{ arn: CT_BASELINE_ARN, name: CONTROL_TOWER_BASELINE_NAME }],
    });
    ctMock.on(ListEnabledBaselinesCommand).resolves({
      enabledBaselines: [
        {
          arn: ENABLED_ARN,
          baselineIdentifier: CT_BASELINE_ARN,
          targetIdentifier: OU_ARN,
          statusSummary: { status: "SUCCEEDED" },
        },
      ],
    });
    await expect(findRegisteredOuBaseline(CTX, OU_ARN)).resolves.toEqual({
      arn: ENABLED_ARN,
      baselineIdentifier: CT_BASELINE_ARN,
      targetIdentifier: OU_ARN,
      baselineVersion: undefined,
      status: "SUCCEEDED",
    });
  });

  it("findRegisteredOuBaseline returns undefined when the OU is not registered", async () => {
    ctMock.on(ListBaselinesCommand).resolves({
      baselines: [{ arn: CT_BASELINE_ARN, name: CONTROL_TOWER_BASELINE_NAME }],
    });
    ctMock.on(ListEnabledBaselinesCommand).resolves({ enabledBaselines: [] });
    await expect(findRegisteredOuBaseline(CTX, OU_ARN)).resolves.toBe(
      undefined
    );
  });

  it("registerOrganizationalUnit is idempotent when already registered", async () => {
    ctMock.on(ListBaselinesCommand).resolves({
      baselines: [{ arn: CT_BASELINE_ARN, name: CONTROL_TOWER_BASELINE_NAME }],
    });
    ctMock.on(ListEnabledBaselinesCommand).resolves({
      enabledBaselines: [
        {
          arn: ENABLED_ARN,
          baselineIdentifier: CT_BASELINE_ARN,
          targetIdentifier: OU_ARN,
          statusSummary: { status: "SUCCEEDED" },
        },
      ],
    });

    await expect(
      registerOrganizationalUnit(CTX, OU_ARN, "4.0")
    ).resolves.toEqual({
      ouArn: OU_ARN,
      enabledBaselineArn: ENABLED_ARN,
      alreadyRegistered: true,
    });
    expect(ctMock.commandCalls(EnableBaselineCommand)).toHaveLength(0);
  });

  it("registerOrganizationalUnit retries when prior registration failed", async () => {
    ctMock.on(ListBaselinesCommand).resolves({
      baselines: [{ arn: CT_BASELINE_ARN, name: CONTROL_TOWER_BASELINE_NAME }],
    });
    ctMock.on(ListEnabledBaselinesCommand).resolves({
      enabledBaselines: [
        {
          arn: ENABLED_ARN,
          baselineIdentifier: CT_BASELINE_ARN,
          targetIdentifier: OU_ARN,
          statusSummary: { status: "FAILED" },
        },
      ],
    });
    ctMock.on(EnableBaselineCommand).resolves({
      arn: "arn:aws:controltower:us-east-1:111122223333:enabledbaseline/retry",
      operationIdentifier: "op-retry",
    });

    await expect(
      registerOrganizationalUnit(CTX, OU_ARN, "4.0")
    ).resolves.toMatchObject({
      alreadyRegistered: false,
      operationIdentifier: "op-retry",
    });
    expect(ctMock.commandCalls(EnableBaselineCommand)).toHaveLength(1);
  });

  it("registerOrganizationalUnit enables the baseline with Identity Center param", async () => {
    ctMock.on(ListBaselinesCommand).resolves({
      baselines: [
        { arn: CT_BASELINE_ARN, name: CONTROL_TOWER_BASELINE_NAME },
        { arn: IC_BASELINE_ARN, name: IDENTITY_CENTER_BASELINE_NAME },
      ],
    });
    ctMock
      .on(ListEnabledBaselinesCommand)
      .resolvesOnce({ enabledBaselines: [] })
      .resolvesOnce({
        enabledBaselines: [
          {
            arn: IC_ENABLED_ARN,
            baselineIdentifier: IC_BASELINE_ARN,
            targetIdentifier:
              "arn:aws:organizations::111122223333:account/o-abcdef1234/111122223333",
          },
        ],
      });
    ctMock.on(EnableBaselineCommand).resolves({
      arn: ENABLED_ARN,
      operationIdentifier: "op-123",
    });

    await expect(
      registerOrganizationalUnit(CTX, OU_ARN, "4.0")
    ).resolves.toEqual({
      ouArn: OU_ARN,
      enabledBaselineArn: ENABLED_ARN,
      operationIdentifier: "op-123",
      alreadyRegistered: false,
    });

    const call = ctMock.commandCalls(EnableBaselineCommand)[0];
    expect(call?.args[0].input).toMatchObject({
      baselineIdentifier: CT_BASELINE_ARN,
      baselineVersion: "4.0",
      targetIdentifier: OU_ARN,
      parameters: [
        {
          key: IDENTITY_CENTER_BASELINE_PARAM,
          value: IC_ENABLED_ARN,
        },
      ],
    });
  });

  it("registerOrganizationalUnit omits IC param when IC baseline is absent", async () => {
    ctMock.on(ListBaselinesCommand).resolves({
      baselines: [{ arn: CT_BASELINE_ARN, name: CONTROL_TOWER_BASELINE_NAME }],
    });
    ctMock.on(ListEnabledBaselinesCommand).resolves({ enabledBaselines: [] });
    ctMock.on(EnableBaselineCommand).resolves({
      arn: ENABLED_ARN,
      operationIdentifier: "op-no-ic",
    });

    await expect(
      registerOrganizationalUnit(CTX, OU_ARN, "4.0")
    ).resolves.toMatchObject({ alreadyRegistered: false });

    const call = ctMock.commandCalls(EnableBaselineCommand)[0];
    expect(call?.args[0].input.parameters).toBeUndefined();
  });

  it("waitForBaselineOperation returns the terminal status", async () => {
    ctMock
      .on(GetBaselineOperationCommand)
      .resolvesOnce({
        baselineOperation: { status: "IN_PROGRESS" },
      })
      .resolvesOnce({
        baselineOperation: { status: "FAILED" },
      });

    await expect(
      waitForBaselineOperation(CTX, "op-123", async () => undefined, 5)
    ).resolves.toBe("FAILED");
  });

  it("waitForBaselineOperation times out when remaining attempts are exhausted", async () => {
    ctMock.on(GetBaselineOperationCommand).resolves({
      baselineOperation: { status: "IN_PROGRESS" },
    });

    await expect(
      waitForBaselineOperation(CTX, "op-timeout", async () => undefined, 1)
    ).rejects.toBeInstanceOf(CliError);
  });
});
