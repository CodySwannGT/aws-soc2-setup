import {
  CreateDetectorCommand,
  GuardDutyClient,
  ListDetectorsCommand,
  UpdateDetectorCommand,
} from "@aws-sdk/client-guardduty";
import {
  BatchGetAccountStatusCommand,
  EnableCommand,
  Inspector2Client,
  UpdateConfigurationCommand,
} from "@aws-sdk/client-inspector2";
import {
  EnableMacieCommand,
  Macie2Client,
  UpdateAutomatedDiscoveryConfigurationCommand,
} from "@aws-sdk/client-macie2";
import {
  BatchEnableStandardsCommand,
  EnableSecurityHubCommand,
  SecurityHubClient,
} from "@aws-sdk/client-securityhub";
import { mockClient } from "aws-sdk-client-mock";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  enableGuardDuty,
  enableInspector,
  enableMacie,
  enableSecurityHub,
} from "../../src/security/detectors.js";

const gdMock = mockClient(GuardDutyClient);
const shMock = mockClient(SecurityHubClient);
const macieMock = mockClient(Macie2Client);
const inspectorMock = mockClient(Inspector2Client);

const CTX = { region: "us-east-1" };

const noDelay = async (): Promise<void> => undefined;

const ecrStatus = (status: "ENABLED" | "ENABLING") => ({
  accounts: [
    {
      accountId: "123456789012",
      state: {
        status: "ENABLED" as const,
        errorCode: undefined,
        errorMessage: undefined,
      },
      resourceState: {
        ec2: undefined,
        ecr: { status, errorCode: undefined, errorMessage: undefined },
      },
    },
  ],
});

describe("security/detectors", () => {
  let writes: string[] = [];
  const output = (): string => writes.join("");

  beforeEach(() => {
    gdMock.reset();
    shMock.reset();
    macieMock.reset();
    inspectorMock.reset();
    writes = [];
    vi.spyOn(process.stdout, "write").mockImplementation(chunk => {
      writes.push(String(chunk));
      return true;
    });
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("enableGuardDuty creates a detector when none exists", async () => {
    gdMock.on(ListDetectorsCommand).resolves({ DetectorIds: [] });
    gdMock.on(CreateDetectorCommand).resolves({ DetectorId: "det-1" });
    await enableGuardDuty(CTX);
    expect(gdMock.commandCalls(CreateDetectorCommand)).toHaveLength(1);
  });

  it("enableGuardDuty updates an existing detector", async () => {
    gdMock.on(ListDetectorsCommand).resolves({ DetectorIds: ["det-1"] });
    gdMock.on(UpdateDetectorCommand).resolves({});
    await enableGuardDuty(CTX);
    expect(gdMock.commandCalls(UpdateDetectorCommand)).toHaveLength(1);
  });

  it("enableSecurityHub enables the hub and CIS standard", async () => {
    shMock.on(EnableSecurityHubCommand).resolves({});
    shMock.on(BatchEnableStandardsCommand).resolves({});
    await enableSecurityHub(CTX);
    expect(shMock.commandCalls(BatchEnableStandardsCommand)).toHaveLength(1);
  });

  it("enableSecurityHub tolerates an already-enabled hub", async () => {
    shMock.on(EnableSecurityHubCommand).rejects(new Error("already enabled"));
    shMock.on(BatchEnableStandardsCommand).resolves({});
    await expect(enableSecurityHub(CTX)).resolves.toBeUndefined();
  });

  it("enableMacie enables Macie and discovery", async () => {
    macieMock.on(EnableMacieCommand).resolves({});
    macieMock.on(UpdateAutomatedDiscoveryConfigurationCommand).resolves({});
    await enableMacie(CTX);
    expect(
      macieMock.commandCalls(UpdateAutomatedDiscoveryConfigurationCommand)
    ).toHaveLength(1);
  });

  it("enableInspector enables scanning and configuration", async () => {
    inspectorMock.on(EnableCommand).resolves({});
    inspectorMock
      .on(BatchGetAccountStatusCommand)
      .resolves(ecrStatus("ENABLED"));
    inspectorMock.on(UpdateConfigurationCommand).resolves({});
    await enableInspector(CTX, noDelay);
    expect(inspectorMock.commandCalls(EnableCommand)).toHaveLength(1);
    expect(
      inspectorMock.commandCalls(UpdateConfigurationCommand)[0]?.args[0].input
    ).toEqual({ ecrConfiguration: { rescanDuration: "DAYS_30" } });
  });

  it("enableInspector waits for ECR scanning to finish enabling first", async () => {
    inspectorMock.on(EnableCommand).resolves({});
    inspectorMock
      .on(BatchGetAccountStatusCommand)
      .resolvesOnce(ecrStatus("ENABLING"))
      .resolvesOnce(ecrStatus("ENABLING"))
      .resolves(ecrStatus("ENABLED"));
    inspectorMock.on(UpdateConfigurationCommand).resolves({});
    const delay = vi.fn(async () => undefined);

    await enableInspector(CTX, delay);

    expect(delay).toHaveBeenCalledTimes(2);
    expect(inspectorMock.commandCalls(UpdateConfigurationCommand)).toHaveLength(
      1
    );
  });

  it("enableInspector skips the ECR update when ECR never enables", async () => {
    inspectorMock.on(EnableCommand).resolves({});
    inspectorMock
      .on(BatchGetAccountStatusCommand)
      .resolves(ecrStatus("ENABLING"));

    await enableInspector(CTX, noDelay);

    expect(inspectorMock.commandCalls(UpdateConfigurationCommand)).toHaveLength(
      0
    );
    expect(output()).toContain("ENABLING");
  });

  it("enableInspector stops polling and reports when status is unreadable", async () => {
    inspectorMock.on(EnableCommand).resolves({});
    inspectorMock
      .on(BatchGetAccountStatusCommand)
      .rejects(new Error("not authorized to BatchGetAccountStatus"));
    const delay = vi.fn(async () => undefined);

    await enableInspector(CTX, delay);

    expect(delay).not.toHaveBeenCalled();
    expect(inspectorMock.commandCalls(UpdateConfigurationCommand)).toHaveLength(
      0
    );
    expect(output()).toContain("not authorized to BatchGetAccountStatus");
  });

  it("enableInspector surfaces the AWS error when the update fails", async () => {
    inspectorMock.on(EnableCommand).resolves({});
    inspectorMock
      .on(BatchGetAccountStatusCommand)
      .resolves(ecrStatus("ENABLED"));
    inspectorMock
      .on(UpdateConfigurationCommand)
      .rejects(new Error("Member accounts cannot update configuration"));

    await enableInspector(CTX, noDelay);

    expect(output()).toContain(
      "Failed to update Inspector scanning settings: Member accounts cannot update configuration"
    );
  });
});
