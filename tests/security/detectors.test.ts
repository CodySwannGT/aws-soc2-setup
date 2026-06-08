import {
  CreateDetectorCommand,
  GuardDutyClient,
  ListDetectorsCommand,
  UpdateDetectorCommand,
} from "@aws-sdk/client-guardduty";
import {
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

describe("security/detectors", () => {
  beforeEach(() => {
    gdMock.reset();
    shMock.reset();
    macieMock.reset();
    inspectorMock.reset();
    vi.spyOn(process.stdout, "write").mockReturnValue(true);
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
    inspectorMock.on(UpdateConfigurationCommand).resolves({});
    await enableInspector(CTX);
    expect(inspectorMock.commandCalls(EnableCommand)).toHaveLength(1);
  });
});
