import {
  AttachPolicyCommand,
  CreatePolicyCommand,
  DescribePolicyCommand,
  DuplicatePolicyAttachmentException,
  EnablePolicyTypeCommand,
  ListPoliciesCommand,
  ListRootsCommand,
  OrganizationsClient,
  PolicyTypeAlreadyEnabledException,
  UpdatePolicyCommand,
} from "@aws-sdk/client-organizations";

import { buildClientConfig } from "../lib/aws.js";
import type { GlobalOptions } from "../lib/config.js";
import { CliError } from "../lib/errors.js";
import { collectPaged } from "../lib/paginate.js";

/** AWS context for service control policy operations. */
export type ScpContext = Pick<GlobalOptions, "region" | "profile">;

/** A service control policy's identity in AWS Organizations. */
export interface ScpSummary {
  id: string;
  name: string;
}

/** Result of ensuring an SCP exists with the desired content. */
export interface EnsuredScp {
  id: string;
  created: boolean;
  updated: boolean;
}

const orgClient = (context: ScpContext): OrganizationsClient =>
  new OrganizationsClient(buildClientConfig(context));

/**
 * Look up the organization's root id (the `r-xxxx` container all OUs and the
 * SCP policy type hang off).
 * @param context - AWS region/profile context.
 * @returns The organization root id.
 */
export const getOrganizationRootId = async (
  context: ScpContext
): Promise<string> => {
  const result = await orgClient(context).send(new ListRootsCommand({}));
  const rootId = result.Roots?.[0]?.Id;
  if (!rootId) {
    throw new CliError(
      "No organization root found. Create the organization first (`controltower create-organization`)."
    );
  }
  return rootId;
};

const isPolicyTypeAlreadyEnabled = (error: unknown): boolean =>
  error instanceof PolicyTypeAlreadyEnabledException ||
  (error instanceof Error &&
    error.name === "PolicyTypeAlreadyEnabledException");

/**
 * Enable the SERVICE_CONTROL_POLICY policy type on the organization root.
 * Idempotent — an already-enabled type is not an error.
 * @param context - AWS region/profile context.
 * @param rootId - The organization root id.
 */
export const ensureScpTypeEnabled = async (
  context: ScpContext,
  rootId: string
): Promise<void> => {
  try {
    await orgClient(context).send(
      new EnablePolicyTypeCommand({
        RootId: rootId,
        PolicyType: "SERVICE_CONTROL_POLICY",
      })
    );
  } catch (error) {
    if (!isPolicyTypeAlreadyEnabled(error)) {
      throw error;
    }
  }
};

/**
 * Find a service control policy by name.
 * @param context - AWS region/profile context.
 * @param name - The policy name to look for.
 * @returns The policy summary, or undefined when no policy has that name.
 */
export const findPolicyByName = async (
  context: ScpContext,
  name: string
): Promise<ScpSummary | undefined> => {
  const client = orgClient(context);
  const policies = await collectPaged(async token => {
    const page = await client.send(
      new ListPoliciesCommand({
        Filter: "SERVICE_CONTROL_POLICY",
        NextToken: token,
      })
    );
    return { items: page.Policies ?? [], next: page.NextToken };
  });
  const match = policies.find(policy => policy.Name === name);
  return match?.Id && match.Name
    ? { id: match.Id, name: match.Name }
    : undefined;
};

const policyContent = async (
  context: ScpContext,
  policyId: string
): Promise<string | undefined> => {
  const result = await orgClient(context).send(
    new DescribePolicyCommand({ PolicyId: policyId })
  );
  return result.Policy?.Content;
};

const normalizeJson = (content: string): string => {
  try {
    return JSON.stringify(JSON.parse(content));
  } catch {
    return content;
  }
};

const createPolicy = async (
  context: ScpContext,
  name: string,
  description: string,
  content: string
): Promise<EnsuredScp> => {
  const result = await orgClient(context).send(
    new CreatePolicyCommand({
      Name: name,
      Description: description,
      Type: "SERVICE_CONTROL_POLICY",
      Content: content,
    })
  );
  const id = result.Policy?.PolicySummary?.Id;
  if (!id) {
    throw new CliError(
      `AWS Organizations created policy ${name} but returned no id.`
    );
  }
  return { id, created: true, updated: false };
};

const updatePolicyIfDrifted = async (
  context: ScpContext,
  existing: ScpSummary,
  description: string,
  content: string
): Promise<EnsuredScp> => {
  const current = await policyContent(context, existing.id);
  if (current && normalizeJson(current) === normalizeJson(content)) {
    return { id: existing.id, created: false, updated: false };
  }
  await orgClient(context).send(
    new UpdatePolicyCommand({
      PolicyId: existing.id,
      Description: description,
      Content: content,
    })
  );
  return { id: existing.id, created: false, updated: true };
};

/**
 * Create the named SCP, or update its content when it exists but has drifted.
 * @param context - AWS region/profile context.
 * @param name - The policy name.
 * @param description - The policy description.
 * @param content - The desired policy document (JSON string).
 * @returns The policy id and whether it was created or updated.
 */
export const ensurePolicy = async (
  context: ScpContext,
  name: string,
  description: string,
  content: string
): Promise<EnsuredScp> => {
  const existing = await findPolicyByName(context, name);
  if (!existing) {
    return createPolicy(context, name, description, content);
  }
  return updatePolicyIfDrifted(context, existing, description, content);
};

const isDuplicateAttachment = (error: unknown): boolean =>
  error instanceof DuplicatePolicyAttachmentException ||
  (error instanceof Error &&
    error.name === "DuplicatePolicyAttachmentException");

/**
 * Attach an SCP to a root, OU, or account. Idempotent — an existing
 * attachment is not an error.
 * @param context - AWS region/profile context.
 * @param policyId - The policy id to attach.
 * @param targetId - The root, OU, or account id to attach it to.
 * @returns True when newly attached; false when it was already attached.
 */
export const attachPolicyToTarget = async (
  context: ScpContext,
  policyId: string,
  targetId: string
): Promise<boolean> => {
  try {
    await orgClient(context).send(
      new AttachPolicyCommand({ PolicyId: policyId, TargetId: targetId })
    );
    return true;
  } catch (error) {
    if (isDuplicateAttachment(error)) {
      return false;
    }
    throw error;
  }
};
