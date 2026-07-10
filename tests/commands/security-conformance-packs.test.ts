import { afterEach, describe, expect, it, vi } from "vitest";

import { handleConformancePacks } from "../../src/commands/security-conformance-packs.js";
import type { GlobalOptions } from "../../src/lib/config.js";
import { CliError } from "../../src/lib/errors.js";
import { buildProgram } from "../../src/program.js";

const globals = (over: Partial<GlobalOptions> = {}): GlobalOptions => ({
  region: "us-east-1",
  dryRun: false,
  yes: false,
  ...over,
});

describe("handleConformancePacks", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("lists packs without deploying", async () => {
    vi.spyOn(process.stdout, "write").mockReturnValue(true);
    const deploy = vi.fn();
    await handleConformancePacks(globals(), { list: true }, deploy);
    expect(deploy).not.toHaveBeenCalled();
  });

  it("makes no deploy calls under --dry-run", async () => {
    vi.spyOn(process.stdout, "write").mockReturnValue(true);
    const deploy = vi.fn();
    await handleConformancePacks(
      globals({ dryRun: true }),
      { preset: "recommended" },
      deploy
    );
    expect(deploy).not.toHaveBeenCalled();
  });

  it("deploys the recommended preset", async () => {
    vi.spyOn(process.stdout, "write").mockReturnValue(true);
    const deploy = vi.fn().mockResolvedValue(undefined);
    await handleConformancePacks(globals(), { preset: "recommended" }, deploy);
    expect(deploy).toHaveBeenCalledWith(
      expect.anything(),
      expect.arrayContaining([
        expect.objectContaining({ id: "cis-level1" }),
        expect.objectContaining({ id: "wa-security" }),
        expect.objectContaining({ id: "ct-detective" }),
      ])
    );
  });

  it("rejects an empty selection", async () => {
    await expect(handleConformancePacks(globals(), {})).rejects.toBeInstanceOf(
      CliError
    );
  });
});

describe("registerConformancePacks wiring", () => {
  it("registers conformance-packs on the security group", () => {
    const security = buildProgram().commands.find(
      command => command.name() === "security"
    );
    const subcommands = (security?.commands ?? []).map(command =>
      command.name()
    );
    expect(subcommands).toContain("conformance-packs");
  });
});
