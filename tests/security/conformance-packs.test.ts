import {
  ConfigServiceClient,
  DescribeConformancePacksCommand,
  PutConformancePackCommand,
} from "@aws-sdk/client-config-service";
import { mockClient } from "aws-sdk-client-mock";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  deployConformancePacks,
  fetchConformancePackTemplate,
  resolveConformancePacks,
  RECOMMENDED_PACK_IDS,
} from "../../src/security/conformance-packs.js";
import { CliError } from "../../src/lib/errors.js";

const configMock = mockClient(ConfigServiceClient);
const CTX = { region: "us-east-1" };
const SMALL_TEMPLATE =
  "Resources:\n  Rule:\n    Type: AWS::Config::ConfigRule\n";
const PACK_CIS = "cis-level1";
const PACK_WA = "wa-security";
const PACK_CT = "ct-detective";

describe("security/conformance-packs", () => {
  beforeEach(() => {
    configMock.reset();
    vi.spyOn(process.stdout, "write").mockReturnValue(true);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("resolveConformancePacks returns catalog entries for known ids", () => {
    const packs = resolveConformancePacks([PACK_CIS, PACK_WA]);
    expect(packs.map(pack => pack.id)).toEqual([PACK_CIS, PACK_WA]);
  });

  it("resolveConformancePacks throws for unknown ids", () => {
    expect(() => resolveConformancePacks(["nope"])).toThrow(CliError);
  });

  it("fetchConformancePackTemplate downloads YAML from GitHub", async () => {
    const fetchImpl = vi.fn().mockResolvedValue({
      ok: true,
      text: async () => SMALL_TEMPLATE,
    });
    await expect(
      fetchConformancePackTemplate("example.yaml", fetchImpl)
    ).resolves.toBe(SMALL_TEMPLATE);
    expect(fetchImpl).toHaveBeenCalledWith(
      expect.stringContaining("example.yaml")
    );
  });

  it("fetchConformancePackTemplate rejects oversized templates", async () => {
    const huge = "x".repeat(60_000);
    const fetchImpl = vi.fn().mockResolvedValue({
      ok: true,
      text: async () => huge,
    });
    await expect(
      fetchConformancePackTemplate("huge.yaml", fetchImpl)
    ).rejects.toBeInstanceOf(CliError);
  });

  it("deployConformancePacks puts each pack", async () => {
    configMock.on(DescribeConformancePacksCommand).resolves({
      ConformancePackDetails: [],
    });
    configMock.on(PutConformancePackCommand).resolves({
      ConformancePackArn: "arn:aws:config:us-east-1:123:conformance-pack/x",
    });
    const fetchImpl = vi.fn().mockResolvedValue({
      ok: true,
      text: async () => SMALL_TEMPLATE,
    });
    const packs = resolveConformancePacks([PACK_CIS]);
    await deployConformancePacks(CTX, packs, fetchImpl);
    expect(configMock.commandCalls(PutConformancePackCommand)).toHaveLength(1);
    expect(
      configMock.commandCalls(PutConformancePackCommand)[0]?.args[0].input
    ).toMatchObject({
      ConformancePackName: "SOC2-CIS-AWS-Foundations-Level1",
      TemplateBody: SMALL_TEMPLATE,
    });
  });

  it("recommended preset includes three packs", () => {
    expect([...RECOMMENDED_PACK_IDS]).toEqual([PACK_CIS, PACK_WA, PACK_CT]);
  });
});
