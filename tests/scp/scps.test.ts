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
import { mockClient } from "aws-sdk-client-mock";
import { beforeEach, describe, expect, it } from "vitest";

import { CliError } from "../../src/lib/errors.js";
import {
  attachPolicyToTarget,
  ensurePolicy,
  ensureScpTypeEnabled,
  findPolicyByName,
  getOrganizationRootId,
} from "../../src/scp/scps.js";

const orgMock = mockClient(OrganizationsClient);

const CTX = { region: "us-east-1" };
const ROOT_ID = "r-abcd";
const POLICY_ID = "p-12345678";
const POLICY_NAME = "DenyLongLivedIamCredentials";
const CONTENT = JSON.stringify({ Version: "2012-10-17", Statement: [] });

describe("scp/scps", () => {
  beforeEach(() => {
    orgMock.reset();
  });

  it("getOrganizationRootId returns the first root", async () => {
    orgMock.on(ListRootsCommand).resolves({ Roots: [{ Id: ROOT_ID }] });
    await expect(getOrganizationRootId(CTX)).resolves.toBe(ROOT_ID);
  });

  it("getOrganizationRootId throws when no organization exists", async () => {
    orgMock.on(ListRootsCommand).resolves({ Roots: [] });
    await expect(getOrganizationRootId(CTX)).rejects.toBeInstanceOf(CliError);
  });

  it("ensureScpTypeEnabled tolerates an already-enabled type", async () => {
    orgMock.on(EnablePolicyTypeCommand).rejects(
      new PolicyTypeAlreadyEnabledException({
        message: "already enabled",
        $metadata: {},
      })
    );
    await expect(ensureScpTypeEnabled(CTX, ROOT_ID)).resolves.toBeUndefined();
  });

  it("ensureScpTypeEnabled rethrows other errors", async () => {
    orgMock.on(EnablePolicyTypeCommand).rejects(new Error("denied"));
    await expect(ensureScpTypeEnabled(CTX, ROOT_ID)).rejects.toThrow("denied");
  });

  it("findPolicyByName follows pagination to find the policy", async () => {
    orgMock
      .on(ListPoliciesCommand)
      .resolvesOnce({
        Policies: [{ Id: "p-other", Name: "Other" }],
        NextToken: "page2",
      })
      .resolvesOnce({
        Policies: [{ Id: POLICY_ID, Name: POLICY_NAME }],
      });
    await expect(findPolicyByName(CTX, POLICY_NAME)).resolves.toEqual({
      id: POLICY_ID,
      name: POLICY_NAME,
    });
  });

  it("ensurePolicy creates the policy when missing", async () => {
    orgMock.on(ListPoliciesCommand).resolves({ Policies: [] });
    orgMock.on(CreatePolicyCommand).resolves({
      Policy: { PolicySummary: { Id: POLICY_ID } },
    });
    await expect(
      ensurePolicy(CTX, POLICY_NAME, "desc", CONTENT)
    ).resolves.toEqual({ id: POLICY_ID, created: true, updated: false });
  });

  it("ensurePolicy is a no-op when content matches", async () => {
    orgMock
      .on(ListPoliciesCommand)
      .resolves({ Policies: [{ Id: POLICY_ID, Name: POLICY_NAME }] });
    orgMock.on(DescribePolicyCommand).resolves({
      Policy: { Content: JSON.stringify(JSON.parse(CONTENT), undefined, 4) },
    });
    await expect(
      ensurePolicy(CTX, POLICY_NAME, "desc", CONTENT)
    ).resolves.toEqual({ id: POLICY_ID, created: false, updated: false });
    expect(orgMock.commandCalls(UpdatePolicyCommand)).toHaveLength(0);
  });

  it("ensurePolicy updates the policy when content drifted", async () => {
    orgMock
      .on(ListPoliciesCommand)
      .resolves({ Policies: [{ Id: POLICY_ID, Name: POLICY_NAME }] });
    orgMock
      .on(DescribePolicyCommand)
      .resolves({ Policy: { Content: '{"Version":"old"}' } });
    orgMock.on(UpdatePolicyCommand).resolves({});
    await expect(
      ensurePolicy(CTX, POLICY_NAME, "desc", CONTENT)
    ).resolves.toEqual({ id: POLICY_ID, created: false, updated: true });
  });

  it("attachPolicyToTarget reports a new attachment", async () => {
    orgMock.on(AttachPolicyCommand).resolves({});
    await expect(attachPolicyToTarget(CTX, POLICY_ID, ROOT_ID)).resolves.toBe(
      true
    );
  });

  it("attachPolicyToTarget tolerates a duplicate attachment", async () => {
    orgMock.on(AttachPolicyCommand).rejects(
      new DuplicatePolicyAttachmentException({
        message: "already attached",
        $metadata: {},
      })
    );
    await expect(attachPolicyToTarget(CTX, POLICY_ID, ROOT_ID)).resolves.toBe(
      false
    );
  });

  it("attachPolicyToTarget rethrows other errors", async () => {
    orgMock.on(AttachPolicyCommand).rejects(new Error("denied"));
    await expect(attachPolicyToTarget(CTX, POLICY_ID, ROOT_ID)).rejects.toThrow(
      "denied"
    );
  });
});
