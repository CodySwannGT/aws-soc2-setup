import { afterEach, describe, expect, it, vi } from "vitest";

import { handleSetup, type SetupRunners } from "../../src/commands/setup.js";
import type { GlobalOptions } from "../../src/lib/config.js";
import { SETUP_PLAN } from "../../src/orchestrator/plan.js";
import { buildProgram } from "../../src/program.js";

const globals = (over: Partial<GlobalOptions> = {}): GlobalOptions => ({
  region: "us-east-1",
  dryRun: false,
  yes: false,
  ...over,
});

const makeRunners = (): SetupRunners => ({
  createOus: vi.fn().mockResolvedValue(undefined),
  enableSecurity: vi.fn().mockResolvedValue(undefined),
  enableControls: vi.fn().mockResolvedValue(undefined),
  configureBackup: vi.fn().mockResolvedValue(undefined),
  configureAudit: vi.fn().mockResolvedValue(undefined),
});

describe("SETUP_PLAN", () => {
  it("documents all sixteen ordered steps", () => {
    expect(SETUP_PLAN).toHaveLength(16);
    expect(SETUP_PLAN.map(step => step.number)).toEqual(
      Array.from({ length: 16 }, (_, i) => i + 1)
    );
  });
});

describe("handleSetup", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("prints the plan and runs nothing under --dry-run", async () => {
    vi.spyOn(process.stdout, "write").mockReturnValue(true);
    const runners = makeRunners();
    await handleSetup(globals({ dryRun: true }), {}, runners);
    expect(runners.createOus).not.toHaveBeenCalled();
  });

  it("runs the always-on steps and skips input-gated steps", async () => {
    vi.spyOn(process.stdout, "write").mockReturnValue(true);
    const runners = makeRunners();
    await handleSetup(globals(), {}, runners);
    expect(runners.createOus).toHaveBeenCalledWith(expect.anything(), {
      all: true,
    });
    expect(runners.enableSecurity).toHaveBeenCalledWith(expect.anything(), {
      all: true,
    });
    expect(runners.enableControls).not.toHaveBeenCalled();
    expect(runners.configureBackup).not.toHaveBeenCalled();
    expect(runners.configureAudit).not.toHaveBeenCalled();
  });

  it("runs input-gated steps when their inputs are provided", async () => {
    vi.spyOn(process.stdout, "write").mockReturnValue(true);
    const runners = makeRunners();
    await handleSetup(
      globals(),
      {
        ou: "ou-abcd-12345678",
        centralAccount: "111111111111",
        adminAccount: "222222222222",
        auditAccount: "333333333333",
      },
      runners
    );
    expect(runners.enableControls).toHaveBeenCalledTimes(1);
    expect(runners.configureBackup).toHaveBeenCalledTimes(1);
    expect(runners.configureAudit).toHaveBeenCalledTimes(1);
  });
});

describe("registerSetup", () => {
  it("registers the setup command", () => {
    const names = buildProgram().commands.map(command => command.name());
    expect(names).toContain("setup");
  });
});
