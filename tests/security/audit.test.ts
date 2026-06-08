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
  DescribeOrganizationCommand,
  OrganizationsClient,
} from "@aws-sdk/client-organizations";
import { mockClient } from "aws-sdk-client-mock";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  createSoc2Framework,
  enableAuditManager,
  ensureConfigAggregator,
  isManagementAccount,
  type AuditOptions,
} from "../../src/security/audit.js";

const amMock = mockClient(AuditManagerClient);
const orgMock = mockClient(OrganizationsClient);
const configMock = mockClient(ConfigServiceClient);

const CTX = { region: "us-east-1" };
const ACCOUNT = "123456789012";
const BUCKET = "audit-reports-123456789012";
const CONSOLE_ERROR = "Please complete AWS Audit Manager setup from home page";

const auditOptions = (over: Partial<AuditOptions> = {}): AuditOptions => ({
  accountId: ACCOUNT,
  bucket: BUCKET,
  isManagement: false,
  ...over,
});

describe("security/audit", () => {
  beforeEach(() => {
    amMock.reset();
    orgMock.reset();
    configMock.reset();
    vi.spyOn(process.stdout, "write").mockReturnValue(true);
    vi.spyOn(process.stderr, "write").mockReturnValue(true);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("isManagementAccount is true when describe-organization succeeds", async () => {
    orgMock.on(DescribeOrganizationCommand).resolves({});
    await expect(isManagementAccount(CTX)).resolves.toBe(true);
  });

  it("isManagementAccount is false when describe-organization throws", async () => {
    orgMock.on(DescribeOrganizationCommand).rejects(new Error("denied"));
    await expect(isManagementAccount(CTX)).resolves.toBe(false);
  });

  it("enableAuditManager short-circuits when already ACTIVE", async () => {
    amMock.on(GetAccountStatusCommand).resolves({ status: "ACTIVE" });
    await expect(enableAuditManager(CTX, auditOptions())).resolves.toBe(true);
    expect(amMock.commandCalls(UpdateSettingsCommand)).toHaveLength(0);
  });

  it("enableAuditManager registers and enables when inactive", async () => {
    amMock.on(GetAccountStatusCommand).resolves({ status: "INACTIVE" });
    amMock.on(RegisterOrganizationAdminAccountCommand).resolves({});
    amMock.on(UpdateSettingsCommand).resolves({});
    await expect(enableAuditManager(CTX, auditOptions())).resolves.toBe(true);
  });

  it("enableAuditManager returns false when console setup is required", async () => {
    amMock.on(GetAccountStatusCommand).resolves({ status: "INACTIVE" });
    amMock.on(RegisterOrganizationAdminAccountCommand).resolves({});
    amMock.on(UpdateSettingsCommand).rejects(new Error(CONSOLE_ERROR));
    await expect(enableAuditManager(CTX, auditOptions())).resolves.toBe(false);
  });

  it("createSoc2Framework creates an assessment when the framework exists", async () => {
    amMock.on(ListAssessmentFrameworksCommand).resolves({
      frameworkMetadataList: [{ name: "SOC 2", id: "fw-1" }],
    });
    amMock
      .on(CreateAssessmentCommand)
      .resolves({ assessment: { metadata: { id: "as-1" } } });
    await createSoc2Framework(CTX, auditOptions());
    expect(amMock.commandCalls(CreateAssessmentCommand)).toHaveLength(1);
  });

  it("createSoc2Framework warns when the framework is missing", async () => {
    amMock
      .on(ListAssessmentFrameworksCommand)
      .resolves({ frameworkMetadataList: [] });
    await createSoc2Framework(CTX, auditOptions());
    expect(amMock.commandCalls(CreateAssessmentCommand)).toHaveLength(0);
  });

  it("ensureConfigAggregator creates the aggregator when Config is on and it is absent", async () => {
    configMock
      .on(DescribeConfigurationRecordersCommand)
      .resolves({ ConfigurationRecorders: [{ name: "default" }] });
    configMock
      .on(DescribeConfigurationAggregatorsCommand)
      .resolves({ ConfigurationAggregators: [] });
    configMock.on(PutConfigurationAggregatorCommand).resolves({});
    await ensureConfigAggregator(CTX, ACCOUNT);
    expect(
      configMock.commandCalls(PutConfigurationAggregatorCommand)
    ).toHaveLength(1);
  });

  it("ensureConfigAggregator warns when Config is not enabled", async () => {
    configMock
      .on(DescribeConfigurationRecordersCommand)
      .resolves({ ConfigurationRecorders: [] });
    await ensureConfigAggregator(CTX, ACCOUNT);
    expect(
      configMock.commandCalls(PutConfigurationAggregatorCommand)
    ).toHaveLength(0);
  });
});
