import {
  CreateAliasCommand,
  CreateKeyCommand,
  KMSClient,
  ListAliasesCommand,
} from "@aws-sdk/client-kms";
import { mockClient } from "aws-sdk-client-mock";
import { beforeEach, describe, expect, it } from "vitest";

import {
  aliasExists,
  createKey,
  ensureAlias,
  extractKeyId,
} from "../../src/kms/keys.js";
import { CliError } from "../../src/lib/errors.js";
import type { KeyPolicy } from "../../src/kms/policy.js";

const kmsMock = mockClient(KMSClient);

const CTX = { region: "us-east-1" };
const KEY_ID = "1234abcd-12ab-34cd-56ef-1234567890ab";
const KEY_ARN = `arn:aws:kms:us-east-1:123456789012:key/${KEY_ID}`;
const ALIAS = "alias/aws-backup-soc2";

const policy: KeyPolicy = { Version: "2012-10-17", Statement: [] };

describe("extractKeyId", () => {
  it("returns the id portion of a key ARN", () => {
    expect(extractKeyId(KEY_ARN)).toBe(KEY_ID);
  });

  it("returns the input unchanged when there is no key/ segment", () => {
    expect(extractKeyId(KEY_ID)).toBe(KEY_ID);
  });
});

describe("kms key management", () => {
  beforeEach(() => {
    kmsMock.reset();
  });

  it("createKey returns the new key ARN", async () => {
    kmsMock
      .on(CreateKeyCommand)
      .resolves({ KeyMetadata: { KeyId: KEY_ID, Arn: KEY_ARN } });
    await expect(
      createKey(CTX, { description: "d", policy, multiRegion: true })
    ).resolves.toBe(KEY_ARN);
  });

  it("createKey throws CliError when no ARN is returned", async () => {
    kmsMock.on(CreateKeyCommand).resolves({});
    await expect(
      createKey(CTX, { description: "d", policy })
    ).rejects.toBeInstanceOf(CliError);
  });

  it("aliasExists reflects whether the alias is present", async () => {
    kmsMock
      .on(ListAliasesCommand)
      .resolves({ Aliases: [{ AliasName: ALIAS }] });
    await expect(aliasExists(CTX, ALIAS)).resolves.toBe(true);
    await expect(aliasExists(CTX, "alias/other")).resolves.toBe(false);
  });

  it("ensureAlias creates the alias when it does not exist", async () => {
    kmsMock.on(ListAliasesCommand).resolves({ Aliases: [] });
    kmsMock.on(CreateAliasCommand).resolves({});
    await ensureAlias(CTX, ALIAS, KEY_ID);
    expect(kmsMock.commandCalls(CreateAliasCommand)).toHaveLength(1);
  });

  it("ensureAlias is a no-op when the alias already exists", async () => {
    kmsMock
      .on(ListAliasesCommand)
      .resolves({ Aliases: [{ AliasName: ALIAS }] });
    await ensureAlias(CTX, ALIAS, KEY_ID);
    expect(kmsMock.commandCalls(CreateAliasCommand)).toHaveLength(0);
  });
});
