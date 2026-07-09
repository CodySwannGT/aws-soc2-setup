import {
  DescribeOrganizationCommand,
  ListAccountsCommand,
  ListOrganizationalUnitsForParentCommand,
  ListRootsCommand,
  OrganizationsClient,
} from "@aws-sdk/client-organizations";
import {
  ListInstancesCommand,
  SSOAdminClient,
} from "@aws-sdk/client-sso-admin";
import { GetCallerIdentityCommand, STSClient } from "@aws-sdk/client-sts";
import { mockClient } from "aws-sdk-client-mock";
import { beforeEach, describe, expect, it } from "vitest";

import { gatherEnvironmentStatus } from "../../src/status/environment.js";

const stsMock = mockClient(STSClient);
const orgMock = mockClient(OrganizationsClient);
const ssoMock = mockClient(SSOAdminClient);

const CTX = { region: "us-east-1", profile: "admin" };
const ACCOUNT = "111122223333";
const ADMIN_ARN = `arn:aws:iam::${ACCOUNT}:user/admin`;
const USER_ID = "AIDAEXAMPLE";
const ORG_ID = "o-abcdef1234";
const ROOT_ID = "r-root1";
const SSO_INSTANCE_ARN = "arn:aws:sso:::instance/ssoins-abc";
const IDENTITY_STORE_ID = "d-1234567890";

const resolveIdentity = (): void => {
  stsMock.on(GetCallerIdentityCommand).resolves({
    Account: ACCOUNT,
    Arn: ADMIN_ARN,
    UserId: USER_ID,
  });
};

describe("gatherEnvironmentStatus", () => {
  beforeEach(() => {
    stsMock.reset();
    orgMock.reset();
    ssoMock.reset();
  });

  it("reports ok when identity, org, OUs, Identity Center, and members are present", async () => {
    resolveIdentity();
    orgMock.on(DescribeOrganizationCommand).resolves({
      Organization: { Id: ORG_ID, MasterAccountId: ACCOUNT },
    });
    orgMock.on(ListRootsCommand).resolves({ Roots: [{ Id: ROOT_ID }] });
    orgMock.on(ListOrganizationalUnitsForParentCommand).resolves({
      OrganizationalUnits: [
        { Id: "ou-infra", Name: "Infrastructure" },
        { Id: "ou-work", Name: "Workloads" },
        { Id: "ou-sand", Name: "Sandbox" },
      ],
    });
    orgMock.on(ListAccountsCommand).resolves({
      Accounts: [
        { Id: ACCOUNT, Name: "Management", Status: "ACTIVE" },
        { Id: "444455556666", Name: "Audit", Status: "ACTIVE" },
      ],
    });
    ssoMock.on(ListInstancesCommand).resolves({
      Instances: [
        {
          InstanceArn: SSO_INSTANCE_ARN,
          IdentityStoreId: IDENTITY_STORE_ID,
        },
      ],
    });

    const status = await gatherEnvironmentStatus(CTX);

    expect(status.region).toBe("us-east-1");
    expect(status.profile).toBe("admin");
    expect(status.organizationId).toBe(ORG_ID);
    expect(status.memberAccountCount).toBe(1);
    expect(status.identityStoreId).toBe(IDENTITY_STORE_ID);
    expect(status.ous.every(ou => ou.present)).toBe(true);
    expect(status.checks.every(check => check.state === "ok")).toBe(true);
    expect(status.planSummary.total).toBe(18);
    expect(status.planSummary.automated).toBeGreaterThan(0);
  });

  it("marks missing probes without failing the whole report", async () => {
    resolveIdentity();
    orgMock.on(DescribeOrganizationCommand).rejects(new Error("AccessDenied"));
    orgMock.on(ListRootsCommand).rejects(new Error("AccessDenied"));
    orgMock.on(ListAccountsCommand).rejects(new Error("AccessDenied"));
    ssoMock.on(ListInstancesCommand).resolves({ Instances: [] });

    const status = await gatherEnvironmentStatus(CTX);
    const byId = Object.fromEntries(
      status.checks.map(check => [check.id, check.state])
    );

    expect(byId.identity).toBe("ok");
    expect(byId.organization).toBe("unknown");
    expect(byId.ous).toBe("unknown");
    expect(byId["identity-center"]).toBe("missing");
    expect(byId["member-accounts"]).toBe("unknown");
  });

  it("reports missing recommended OUs when some are absent", async () => {
    resolveIdentity();
    orgMock.on(DescribeOrganizationCommand).resolves({
      Organization: { Id: ORG_ID, MasterAccountId: ACCOUNT },
    });
    orgMock.on(ListRootsCommand).resolves({ Roots: [{ Id: ROOT_ID }] });
    orgMock.on(ListOrganizationalUnitsForParentCommand).resolves({
      OrganizationalUnits: [{ Id: "ou-infra", Name: "Infrastructure" }],
    });
    orgMock.on(ListAccountsCommand).resolves({ Accounts: [] });
    ssoMock.on(ListInstancesCommand).resolves({
      Instances: [
        {
          InstanceArn: SSO_INSTANCE_ARN,
          IdentityStoreId: IDENTITY_STORE_ID,
        },
      ],
    });

    const status = await gatherEnvironmentStatus(CTX);
    const ous = status.checks.find(check => check.id === "ous");

    expect(ous?.state).toBe("missing");
    expect(ous?.detail).toContain("Workloads");
    expect(ous?.detail).toContain("Sandbox");
  });
});
