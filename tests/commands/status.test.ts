import { Command } from "commander";
import { afterEach, describe, expect, it, vi } from "vitest";

import { handleStatus, registerStatus } from "../../src/commands/status.js";
import type { GlobalOptions } from "../../src/lib/config.js";
import { buildProgram } from "../../src/program.js";
import type { EnvironmentStatus } from "../../src/status/environment.js";

const globals = (over: Partial<GlobalOptions> = {}): GlobalOptions => ({
  region: "us-east-1",
  dryRun: false,
  yes: false,
  profile: "admin",
  ...over,
});

const ACCOUNT = "111122223333";
const ADMIN_ARN = `arn:aws:iam::${ACCOUNT}:user/admin`;
const USER_ID = "AIDAEXAMPLE";
const ORG_ID = "o-abcdef1234";
const IDENTITY_STORE_ID = "d-1234567890";
const LABEL_CREDENTIALS = "AWS credentials";
const LABEL_OUS = "Recommended OUs";
const LABEL_IDENTITY_CENTER = "IAM Identity Center";

const readyStatus = (): EnvironmentStatus => ({
  region: "us-east-1",
  profile: "admin",
  identity: {
    account: ACCOUNT,
    arn: ADMIN_ARN,
    userId: USER_ID,
  },
  organizationId: ORG_ID,
  managementAccountId: ACCOUNT,
  memberAccountCount: 2,
  ous: [
    { name: "Infrastructure", id: "ou-1", present: true },
    { name: "Workloads", id: "ou-2", present: true },
    { name: "Sandbox", id: "ou-3", present: true },
  ],
  identityCenterArn: "arn:aws:sso:::instance/ssoins-abc",
  identityStoreId: IDENTITY_STORE_ID,
  checks: [
    {
      id: "identity",
      label: LABEL_CREDENTIALS,
      state: "ok",
      detail: ACCOUNT,
    },
    {
      id: "organization",
      label: "AWS Organizations",
      state: "ok",
      detail: ORG_ID,
    },
    {
      id: "ous",
      label: LABEL_OUS,
      state: "ok",
      detail: "3/3 present",
    },
    {
      id: "identity-center",
      label: LABEL_IDENTITY_CENTER,
      state: "ok",
      detail: IDENTITY_STORE_ID,
    },
    {
      id: "member-accounts",
      label: "Member accounts",
      state: "ok",
      detail: "2 active member account(s)",
    },
  ],
  planSummary: { automated: 8, manual: 11, total: 19 },
});

describe("handleStatus", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("prints environment readiness when all checks pass", async () => {
    const out = vi.spyOn(process.stdout, "write").mockReturnValue(true);
    await handleStatus(globals(), async () => readyStatus());

    const printed = out.mock.calls.map(call => String(call[0])).join("");
    expect(printed).toContain("environment status");
    expect(printed).toContain("us-east-1");
    expect(printed).toContain("19 steps");
    expect(printed).toContain(LABEL_CREDENTIALS);
    expect(printed).toContain("setup --dry-run");
  });

  it("suggests remediation when checks are missing", async () => {
    const out = vi.spyOn(process.stdout, "write").mockReturnValue(true);
    const status: EnvironmentStatus = {
      ...readyStatus(),
      checks: [
        {
          id: "identity",
          label: LABEL_CREDENTIALS,
          state: "ok",
          detail: ACCOUNT,
        },
        {
          id: "ous",
          label: LABEL_OUS,
          state: "missing",
          detail: "1/3 present; missing Workloads, Sandbox",
        },
        {
          id: "identity-center",
          label: LABEL_IDENTITY_CENTER,
          state: "missing",
          detail: "No enabled Identity Center instance found",
        },
      ],
    };

    await handleStatus(globals(), async () => status);

    const printed = out.mock.calls.map(call => String(call[0])).join("");
    expect(printed).toContain("Suggested next steps");
    expect(printed).toContain("create-ous --all");
    expect(printed).toContain("Enable IAM Identity Center");
  });
});

describe("registerStatus", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("registers status on the root program", () => {
    const program = buildProgram();
    const names = program.commands.map(command => command.name());
    expect(names).toContain("status");
  });

  it("wires a status command onto a bare program", () => {
    const program = new Command();
    registerStatus(program);
    expect(program.commands.map(command => command.name())).toContain("status");
  });
});
