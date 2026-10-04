import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it, vi } from "vitest";

import {
  handleConfigureProfile,
  handleSetStartUrl,
} from "../../src/commands/sso-config.js";
import { buildProgram } from "../../src/program.js";

const SET_START_URL = "set-start-url";

describe("handleConfigureProfile", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("invokes the interactive runner with aws configure sso", async () => {
    vi.spyOn(process.stdout, "write").mockReturnValue(true);
    const run = vi.fn().mockResolvedValue(undefined);
    await handleConfigureProfile(run);
    expect(run).toHaveBeenCalledWith("aws", ["configure", "sso"]);
  });
});

describe("handleSetStartUrl", () => {
  const dirs: string[] = [];

  afterEach(async () => {
    vi.restoreAllMocks();
    await Promise.all(
      dirs.splice(0).map(dir => rm(dir, { recursive: true, force: true }))
    );
  });

  it("rewrites the start URL in the given config file", async () => {
    vi.spyOn(process.stdout, "write").mockReturnValue(true);
    const dir = await mkdtemp(join(tmpdir(), "soc2-cfg-"));
    dirs.push(dir);
    const configPath = join(dir, "config");
    await writeFile(
      configPath,
      "[profile admin]\nsso_start_url = https://old/start\n",
      "utf8"
    );

    await handleSetStartUrl({
      profile: "admin",
      domain: "acme",
      configPath,
    });

    const written = await readFile(configPath, "utf8");
    expect(written).toContain("sso_start_url = https://acme.awsapps.com/start");
    expect(written).not.toContain("https://old/start");
  });
});

describe("registerSsoConfigCommands", () => {
  it("registers configure-profile and set-start-url under sso", () => {
    const sso = buildProgram().commands.find(
      command => command.name() === "sso"
    );
    const subcommands = (sso?.commands ?? []).map(command => command.name());
    expect(subcommands).toEqual(
      expect.arrayContaining(["configure-profile", SET_START_URL])
    );
  });
});

describe("sso set-start-url command", () => {
  const originalExitCode = process.exitCode;
  const dirs: string[] = [];

  afterEach(async () => {
    process.exitCode = originalExitCode;
    vi.restoreAllMocks();
    vi.unstubAllEnvs();
    await Promise.all(
      dirs.splice(0).map(dir => rm(dir, { recursive: true, force: true }))
    );
  });

  const homeWithConfig = async (): Promise<string> => {
    const home = await mkdtemp(join(tmpdir(), "soc2-cfg-"));
    dirs.push(home);
    await mkdir(join(home, ".aws"));
    await writeFile(
      join(home, ".aws", "config"),
      "[profile admin]\nsso_start_url = https://old/start\n",
      "utf8"
    );
    vi.stubEnv("HOME", home);
    return home;
  };

  it("updates the profile named by the global -p, --profile option", async () => {
    vi.spyOn(process.stdout, "write").mockReturnValue(true);
    const home = await homeWithConfig();

    await buildProgram().parseAsync([
      "node",
      "aws-soc2-setup",
      "sso",
      SET_START_URL,
      "-p",
      "admin",
      "-d",
      "acme",
    ]);

    const written = await readFile(join(home, ".aws", "config"), "utf8");
    expect(written).toContain("sso_start_url = https://acme.awsapps.com/start");
    expect(process.exitCode).not.toBe(1);
  });

  it("fails with a usage error when no profile is given", async () => {
    const err = vi.spyOn(process.stderr, "write").mockReturnValue(true);
    const home = await homeWithConfig();

    await buildProgram().parseAsync([
      "node",
      "aws-soc2-setup",
      "sso",
      SET_START_URL,
      "--domain",
      "acme",
    ]);

    expect(process.exitCode).toBe(1);
    expect(err.mock.calls.map(call => String(call[0])).join("")).toContain(
      "--profile"
    );
    const untouched = await readFile(join(home, ".aws", "config"), "utf8");
    expect(untouched).toContain("https://old/start");
  });
});
