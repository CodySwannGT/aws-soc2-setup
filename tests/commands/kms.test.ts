import {
  DescribeKeyCommand,
  DisableKeyRotationCommand,
  EnableKeyRotationCommand,
  GetKeyPolicyCommand,
  GetKeyRotationStatusCommand,
  KMSClient,
  PutKeyPolicyCommand,
} from "@aws-sdk/client-kms";
import { mockClient } from "aws-sdk-client-mock";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { handleKms } from "../../src/commands/kms.js";
import type { GlobalOptions } from "../../src/lib/config.js";
import { buildProgram } from "../../src/program.js";

const kmsMock = mockClient(KMSClient);

const KEY_ID = "1234abcd-12ab-34cd-56ef-1234567890ab";
const ADMIN = "arn:aws:iam::123456789012:role/Admin";

const globals = (overrides: Partial<GlobalOptions> = {}): GlobalOptions => ({
  region: "us-east-1",
  dryRun: false,
  yes: false,
  ...overrides,
});

const primeBaseCalls = (): void => {
  kmsMock.on(DescribeKeyCommand).resolves({
    KeyMetadata: { KeyId: KEY_ID, Arn: "arn:key", KeyState: "Enabled" },
  });
  kmsMock
    .on(GetKeyRotationStatusCommand)
    .resolves({ KeyRotationEnabled: false });
  kmsMock.on(GetKeyPolicyCommand).resolves({
    Policy: JSON.stringify({ Version: "2012-10-17", Statement: [] }),
  });
  kmsMock.on(PutKeyPolicyCommand).resolves({});
  kmsMock.on(EnableKeyRotationCommand).resolves({});
  kmsMock.on(DisableKeyRotationCommand).resolves({});
};

describe("handleKms", () => {
  beforeEach(() => {
    kmsMock.reset();
    primeBaseCalls();
    vi.spyOn(process.stdout, "write").mockReturnValue(true);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("writes the policy back when adding an administrator", async () => {
    await handleKms(globals(), { keyId: KEY_ID, addAdmin: ADMIN });
    expect(kmsMock.commandCalls(PutKeyPolicyCommand)).toHaveLength(1);
  });

  it("does not write the policy under --dry-run", async () => {
    await handleKms(globals({ dryRun: true }), {
      keyId: KEY_ID,
      addAdmin: ADMIN,
    });
    expect(kmsMock.commandCalls(PutKeyPolicyCommand)).toHaveLength(0);
  });

  it("writes the policy back when removing an administrator", async () => {
    kmsMock.on(GetKeyPolicyCommand).resolves({
      Policy: JSON.stringify({
        Version: "2012-10-17",
        Statement: [
          {
            Sid: "Allow administration of the key",
            Effect: "Allow",
            Principal: { AWS: [ADMIN] },
            Action: "kms:*",
            Resource: "*",
          },
        ],
      }),
    });
    await handleKms(globals(), { keyId: KEY_ID, removeAdmin: ADMIN });
    expect(kmsMock.commandCalls(PutKeyPolicyCommand)).toHaveLength(1);
  });

  it("does not write when removing an admin that has no statement", async () => {
    await handleKms(globals(), { keyId: KEY_ID, removeAdmin: ADMIN });
    expect(kmsMock.commandCalls(PutKeyPolicyCommand)).toHaveLength(0);
  });

  it("shows the policy when requested", async () => {
    await handleKms(globals(), { keyId: KEY_ID, showPolicy: true });
    expect(kmsMock.commandCalls(GetKeyPolicyCommand)).toHaveLength(1);
  });

  it("enables rotation when requested", async () => {
    await handleKms(globals(), { keyId: KEY_ID, enableRotation: true });
    expect(kmsMock.commandCalls(EnableKeyRotationCommand)).toHaveLength(1);
  });

  it("disables rotation when requested", async () => {
    await handleKms(globals(), { keyId: KEY_ID, disableRotation: true });
    expect(kmsMock.commandCalls(DisableKeyRotationCommand)).toHaveLength(1);
  });

  it("does not toggle rotation under --dry-run", async () => {
    await handleKms(globals({ dryRun: true }), {
      keyId: KEY_ID,
      enableRotation: true,
    });
    expect(kmsMock.commandCalls(EnableKeyRotationCommand)).toHaveLength(0);
  });

  it("always reports the current rotation status", async () => {
    await handleKms(globals(), { keyId: KEY_ID });
    expect(kmsMock.commandCalls(GetKeyRotationStatusCommand)).toHaveLength(1);
  });
});

describe("registerKms", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("registers the kms command on the program", () => {
    const names = buildProgram().commands.map(command => command.name());
    expect(names).toContain("kms");
  });

  it("runs the kms command end-to-end via the program", async () => {
    kmsMock.reset();
    primeBaseCalls();
    vi.spyOn(process.stdout, "write").mockReturnValue(true);

    await buildProgram().parseAsync([
      "node",
      "aws-soc2-setup",
      "kms",
      "--key-id",
      KEY_ID,
      "--show-policy",
    ]);

    expect(kmsMock.commandCalls(DescribeKeyCommand)).toHaveLength(1);
    expect(kmsMock.commandCalls(GetKeyPolicyCommand)).toHaveLength(1);
  });
});
