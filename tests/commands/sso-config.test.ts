import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it, vi } from "vitest";

import {
  handleConfigureProfile,
  handleSetStartUrl,
} from "../../src/commands/sso-config.js";
import { buildProgram } from "../../src/program.js";

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
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("rewrites the start URL in the given config file", async () => {
    vi.spyOn(process.stdout, "write").mockReturnValue(true);
    const dir = await mkdtemp(join(tmpdir(), "soc2-cfg-"));
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
      expect.arrayContaining(["configure-profile", "set-start-url"])
    );
  });
});
