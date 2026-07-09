import {
  DescribeOrganizationCommand,
  ListOrganizationalUnitsForParentCommand,
  ListRootsCommand,
  OrganizationsClient,
} from "@aws-sdk/client-organizations";
import {
  ListInstancesCommand,
  SSOAdminClient,
} from "@aws-sdk/client-sso-admin";

import { buildClientConfig } from "../lib/aws.js";
import type { GlobalOptions } from "../lib/config.js";
import type { CallerIdentity } from "../lib/sts.js";
import { getCallerIdentity } from "../lib/sts.js";
import { SETUP_PLAN } from "../orchestrator/plan.js";
import { listMemberAccounts } from "../root/root-access.js";

/** AWS context for environment probes. */
export type StatusContext = Pick<GlobalOptions, "region" | "profile">;

/** Outcome of a single environment probe. */
export type CheckState = "ok" | "missing" | "unknown";

/** A named probe result shown by `status`. */
export interface StatusCheck {
  id: string;
  label: string;
  state: CheckState;
  detail: string;
}

/** Presence of a recommended landing-zone OU. */
export interface OuPresence {
  name: string;
  id?: string;
  present: boolean;
}

/** Snapshot of the caller's AWS environment relative to the SOC 2 setup. */
export interface EnvironmentStatus {
  region: string;
  profile?: string;
  identity?: CallerIdentity;
  organizationId?: string;
  managementAccountId?: string;
  memberAccountCount?: number;
  ous: OuPresence[];
  identityCenterArn?: string;
  identityStoreId?: string;
  checks: StatusCheck[];
  planSummary: { automated: number; manual: number; total: number };
}

const RECOMMENDED_OUS = ["Infrastructure", "Workloads", "Sandbox"] as const;
const LABEL_ORGANIZATION = "AWS Organizations";
const LABEL_IDENTITY_CENTER = "IAM Identity Center";
const LABEL_OUS = "Recommended OUs";
const ID_IDENTITY_CENTER = "identity-center";

const orgClient = (context: StatusContext): OrganizationsClient =>
  new OrganizationsClient(buildClientConfig(context));

const ssoClient = (context: StatusContext): SSOAdminClient =>
  new SSOAdminClient(buildClientConfig(context));

const planSummary = (): EnvironmentStatus["planSummary"] => {
  const automated = SETUP_PLAN.filter(step => step.kind === "automated").length;
  const manual = SETUP_PLAN.filter(step => step.kind === "manual").length;
  return { automated, manual, total: SETUP_PLAN.length };
};

const probeIdentity = async (
  context: StatusContext
): Promise<{ identity?: CallerIdentity; check: StatusCheck }> => {
  try {
    const identity = await getCallerIdentity(context);
    return {
      identity,
      check: {
        id: "identity",
        label: "AWS credentials",
        state: "ok",
        detail: `${identity.account} (${identity.arn})`,
      },
    };
  } catch (caught) {
    return {
      check: {
        id: "identity",
        label: "AWS credentials",
        state: "missing",
        detail:
          caught instanceof Error
            ? caught.message
            : "Could not resolve caller identity",
      },
    };
  }
};

const probeOrganization = async (
  context: StatusContext
): Promise<{
  organizationId?: string;
  managementAccountId?: string;
  check: StatusCheck;
}> => {
  try {
    const result = await orgClient(context).send(
      new DescribeOrganizationCommand({})
    );
    const organizationId = result.Organization?.Id;
    const managementAccountId = result.Organization?.MasterAccountId;
    if (!organizationId) {
      return {
        check: {
          id: "organization",
          label: LABEL_ORGANIZATION,
          state: "missing",
          detail: "Organizations is not enabled or returned no id",
        },
      };
    }
    return {
      organizationId,
      managementAccountId,
      check: {
        id: "organization",
        label: LABEL_ORGANIZATION,
        state: "ok",
        detail: managementAccountId
          ? `${organizationId} (management ${managementAccountId})`
          : organizationId,
      },
    };
  } catch (caught) {
    return {
      check: {
        id: "organization",
        label: LABEL_ORGANIZATION,
        state: "unknown",
        detail:
          caught instanceof Error
            ? caught.message
            : "Could not describe the organization",
      },
    };
  }
};

const listRootOuEntries = async (
  context: StatusContext
): Promise<ReadonlyArray<readonly [string, string]>> => {
  const roots = await orgClient(context).send(new ListRootsCommand({}));
  const rootId = roots.Roots?.[0]?.Id;
  if (!rootId) {
    return [];
  }
  const result = await orgClient(context).send(
    new ListOrganizationalUnitsForParentCommand({ ParentId: rootId })
  );
  return (result.OrganizationalUnits ?? [])
    .filter(
      (ou): ou is { Name: string; Id: string } =>
        typeof ou.Name === "string" && typeof ou.Id === "string"
    )
    .map(ou => [ou.Name, ou.Id] as const);
};

const probeOus = async (
  context: StatusContext
): Promise<{ ous: OuPresence[]; check: StatusCheck }> => {
  try {
    const entries = await listRootOuEntries(context);
    const byName = Object.fromEntries(entries) as Record<string, string>;
    const ous: OuPresence[] = RECOMMENDED_OUS.map(name => {
      const id = byName[name];
      return { name, id, present: id !== undefined };
    });
    const present = ous.filter(ou => ou.present).length;
    const missing = ous.filter(ou => !ou.present).map(ou => ou.name);
    return {
      ous,
      check: {
        id: "ous",
        label: LABEL_OUS,
        state: missing.length === 0 ? "ok" : "missing",
        detail:
          missing.length === 0
            ? `${present}/${ous.length} present`
            : `${present}/${ous.length} present; missing ${missing.join(", ")}`,
      },
    };
  } catch (caught) {
    return {
      ous: RECOMMENDED_OUS.map(name => ({ name, present: false })),
      check: {
        id: "ous",
        label: LABEL_OUS,
        state: "unknown",
        detail:
          caught instanceof Error
            ? caught.message
            : "Could not list organizational units",
      },
    };
  }
};

const probeIdentityCenter = async (
  context: StatusContext
): Promise<{
  identityCenterArn?: string;
  identityStoreId?: string;
  check: StatusCheck;
}> => {
  try {
    const result = await ssoClient(context).send(new ListInstancesCommand({}));
    const instance = result.Instances?.[0];
    if (!instance?.InstanceArn || !instance.IdentityStoreId) {
      return {
        check: {
          id: ID_IDENTITY_CENTER,
          label: LABEL_IDENTITY_CENTER,
          state: "missing",
          detail: "No enabled Identity Center instance found",
        },
      };
    }
    return {
      identityCenterArn: instance.InstanceArn,
      identityStoreId: instance.IdentityStoreId,
      check: {
        id: ID_IDENTITY_CENTER,
        label: LABEL_IDENTITY_CENTER,
        state: "ok",
        detail: instance.IdentityStoreId,
      },
    };
  } catch (caught) {
    return {
      check: {
        id: ID_IDENTITY_CENTER,
        label: LABEL_IDENTITY_CENTER,
        state: "unknown",
        detail:
          caught instanceof Error
            ? caught.message
            : "Could not list Identity Center instances",
      },
    };
  }
};

const probeMemberAccounts = async (
  context: StatusContext
): Promise<{ memberAccountCount?: number; check: StatusCheck }> => {
  try {
    const members = await listMemberAccounts(context);
    return {
      memberAccountCount: members.length,
      check: {
        id: "member-accounts",
        label: "Member accounts",
        state: "ok",
        detail: `${members.length} active member account(s)`,
      },
    };
  } catch (caught) {
    return {
      check: {
        id: "member-accounts",
        label: "Member accounts",
        state: "unknown",
        detail:
          caught instanceof Error
            ? caught.message
            : "Could not list member accounts",
      },
    };
  }
};

/**
 * Probe the caller's AWS environment for the pieces the SOC 2 setup expects:
 * credentials, Organizations, recommended OUs, IAM Identity Center, and member
 * accounts. Each probe is independent so a single permission gap does not hide
 * the rest of the report.
 * @param context - Resolved region/profile context.
 * @returns An environment snapshot plus per-check results.
 */
export const gatherEnvironmentStatus = async (
  context: StatusContext
): Promise<EnvironmentStatus> => {
  const identityResult = await probeIdentity(context);
  const organizationResult = await probeOrganization(context);
  const ouResult = await probeOus(context);
  const identityCenterResult = await probeIdentityCenter(context);
  const membersResult = await probeMemberAccounts(context);

  return {
    region: context.region,
    profile: context.profile,
    identity: identityResult.identity,
    organizationId: organizationResult.organizationId,
    managementAccountId: organizationResult.managementAccountId,
    memberAccountCount: membersResult.memberAccountCount,
    ous: ouResult.ous,
    identityCenterArn: identityCenterResult.identityCenterArn,
    identityStoreId: identityCenterResult.identityStoreId,
    checks: [
      identityResult.check,
      organizationResult.check,
      ouResult.check,
      identityCenterResult.check,
      membersResult.check,
    ],
    planSummary: planSummary(),
  };
};
