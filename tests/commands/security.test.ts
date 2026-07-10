import {
  AuditManagerClient,
  CreateAssessmentCommand,
  GetAccountStatusCommand,
  ListAssessmentFrameworksCommand,
  RegisterOrganizationAdminAccountCommand,
  UpdateSettingsCommand,
} from "@aws-sdk/client-auditmanager";
import {
  ConfigServiceClient,
  DescribeConfigurationAggregatorsCommand,
  DescribeConfigurationRecordersCommand,
  PutConfigurationAggregatorCommand,
} from "@aws-sdk/client-config-service";
import {
  CreateDetectorCommand,
  GuardDutyClient,
  ListDetectorsCommand,
} from "@aws-sdk/client-guardduty";
import {
  DescribeOrganizationCommand,
  OrganizationsClient,
} from "@aws-sdk/client-organizations";
import {
  CreateBucketCommand,
  HeadBucketCommand,
  PutBucketEncryptionCommand,
  PutPublicAccessBlockCommand,
  S3Client,
} from "@aws-sdk/client-s3";
import { GetCallerIdentityCommand, STSClient } from "@aws-sdk/client-sts";
import { mockClient } from "aws-sdk-client-mock";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { handleSecurityEnable } from "../../src/commands/security.js";
import { handleSecurityAudit } from "../../src/commands/security-audit.js";
import type { GlobalOptions } from "../../src/lib/config.js";
import { CliError } from "../../src/lib/errors.js";
import { buildProgram } from "../../src/program.js";

const stsMock = mockClient(STSClient);
const gdMock = mockClient(GuardDutyClient);
const s3Mock = mockClient(S3Client);
const orgMock = mockClient(OrganizationsClient);
const amMock = mockClient(AuditManagerClient);
const configMock = mockClient(ConfigServiceClient);

const ACCOUNT = "123456789012";

const globals = (over: Partial<GlobalOptions> = {}): GlobalOptions => ({
  region: "us-east-1",
  dryRun: false,
  yes: false,
  ...over,
});

const primeIdentity = (): void => {
  stsMock.on(GetCallerIdentityCommand).resolves({
    Account: ACCOUNT,
    Arn: `arn:aws:iam::${ACCOUNT}:user/admin`,
    UserId: "AIDA",
  });
};

describe("handleSecurityEnable", () => {
  beforeEach(() => {
    stsMock.reset();
    gdMock.reset();
    primeIdentity();
    vi.spyOn(process.stdout, "write").mockReturnValue(true);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("throws when no services are selected", async () => {
    await expect(handleSecurityEnable(globals(), {})).rejects.toBeInstanceOf(
      CliError
    );
  });

  it("makes no AWS calls under --dry-run", async () => {
    await handleSecurityEnable(globals({ dryRun: true }), { all: true });
    expect(stsMock.commandCalls(GetCallerIdentityCommand)).toHaveLength(0);
  });

  it("enables the selected service", async () => {
    gdMock.on(ListDetectorsCommand).resolves({ DetectorIds: [] });
    gdMock.on(CreateDetectorCommand).resolves({ DetectorId: "det-1" });
    await handleSecurityEnable(globals(), { guardduty: true });
    expect(gdMock.commandCalls(CreateDetectorCommand)).toHaveLength(1);
  });

  it("continues to other services when one fails (per-service isolation)", async () => {
    s3Mock.reset();
    s3Mock.on(HeadBucketCommand).rejects(new Error("404"));
    s3Mock.on(CreateBucketCommand).rejects(new Error("denied"));
    gdMock.on(ListDetectorsCommand).resolves({ DetectorIds: [] });
    gdMock.on(CreateDetectorCommand).resolves({ DetectorId: "det-1" });
    vi.spyOn(process.stderr, "write").mockReturnValue(true);

    // Config fails (bucket creation denied) but GuardDuty must still run.
    await handleSecurityEnable(globals(), { config: true, guardduty: true });

    expect(gdMock.commandCalls(CreateDetectorCommand)).toHaveLength(1);
  });
});

describe("handleSecurityAudit", () => {
  beforeEach(() => {
    stsMock.reset();
    s3Mock.reset();
    orgMock.reset();
    amMock.reset();
    configMock.reset();
    primeIdentity();
    s3Mock.on(HeadBucketCommand).rejects(new Error("404"));
    s3Mock.on(CreateBucketCommand).resolves({});
    s3Mock.on(PutBucketEncryptionCommand).resolves({});
    s3Mock.on(PutPublicAccessBlockCommand).resolves({});
    orgMock.on(DescribeOrganizationCommand).resolves({});
    vi.spyOn(process.stdout, "write").mockReturnValue(true);
    vi.spyOn(process.stderr, "write").mockReturnValue(true);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("makes no bucket calls under --dry-run", async () => {
    await handleSecurityAudit(globals({ dryRun: true }), {
      auditManager: true,
    });
    expect(s3Mock.commandCalls(CreateBucketCommand)).toHaveLength(0);
  });

  it("enables audit manager, framework, and aggregator", async () => {
    amMock.on(GetAccountStatusCommand).resolves({ status: "INACTIVE" });
    amMock.on(RegisterOrganizationAdminAccountCommand).resolves({});
    amMock.on(UpdateSettingsCommand).resolves({});
    amMock.on(ListAssessmentFrameworksCommand).resolves({
      frameworkMetadataList: [{ name: "SOC 2", id: "fw-1" }],
    });
    amMock
      .on(CreateAssessmentCommand)
      .resolves({ assessment: { metadata: { id: "as-1" } } });
    configMock
      .on(DescribeConfigurationRecordersCommand)
      .resolves({ ConfigurationRecorders: [{ name: "default" }] });
    configMock
      .on(DescribeConfigurationAggregatorsCommand)
      .resolves({ ConfigurationAggregators: [] });
    configMock.on(PutConfigurationAggregatorCommand).resolves({});

    await handleSecurityAudit(globals(), {
      auditManager: true,
      framework: true,
      aggregator: true,
    });

    expect(amMock.commandCalls(CreateAssessmentCommand)).toHaveLength(1);
    expect(
      configMock.commandCalls(PutConfigurationAggregatorCommand)
    ).toHaveLength(1);
  });
});

describe("registerSecurity", () => {
  it("registers the security command group with enable, audit, and conformance-packs", () => {
    const security = buildProgram().commands.find(
      command => command.name() === "security"
    );
    const subcommands = (security?.commands ?? []).map(command =>
      command.name()
    );
    expect(subcommands).toEqual(
      expect.arrayContaining(["enable", "audit", "conformance-packs"])
    );
  });
});
