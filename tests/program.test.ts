import { createRequire } from "module";

import type { Command } from "commander";
import { afterEach, describe, expect, it, vi } from "vitest";

import { buildProgram, getVersion } from "../src/program.js";

const require = createRequire(import.meta.url);
const pkg = require("../package.json") as { version: string };

const CLI_NAME = "aws-soc2-setup";

describe("getVersion", () => {
  it("returns the version declared in package.json", () => {
    expect(getVersion()).toBe(pkg.version);
  });
});

describe("buildProgram", () => {
  it("configures the program name and version", () => {
    const program = buildProgram();
    expect(program.name()).toBe(CLI_NAME);
    expect(program.version()).toBe(pkg.version);
  });

  it("registers the status and whoami commands", () => {
    const names = buildProgram().commands.map(command => command.name());
    expect(names).toContain("status");
    expect(names).toContain("whoami");
  });

  describe("global options after the subcommand", () => {
    const PROFILE = "prof";
    const REGION = "eu-west-1";
    const ROOT = "root";
    const REMOVE = "remove-access";
    const PROFILE_FLAG = ["-p", PROFILE];
    const REGION_FLAG = ["-r", REGION];
    const SWITCHES = ["--dry-run", "-y"];

    afterEach(() => {
      vi.restoreAllMocks();
    });

    it.each([
      [[ROOT, REMOVE, ...PROFILE_FLAG, ...REGION_FLAG, "--dry-run", "--yes"]],
      [[...PROFILE_FLAG, ...REGION_FLAG, ...SWITCHES, ROOT, REMOVE]],
      [[ROOT, ...PROFILE_FLAG, REMOVE, ...REGION_FLAG, ...SWITCHES]],
    ])("are honored regardless of position: %j", async argv => {
      const writes: string[] = [];
      vi.spyOn(process.stdout, "write").mockImplementation(chunk => {
        writes.push(String(chunk));
        return true;
      });
      const program = buildProgram();

      await program.parseAsync(argv, { from: "user" });

      expect(program.opts()).toEqual({
        profile: PROFILE,
        region: REGION,
        dryRun: true,
        yes: true,
      });
      expect(writes.join("")).toContain("[dry-run]");
    });

    it("no subcommand redefines a global short or long flag", () => {
      const program = buildProgram();
      const globalFlags = new Set(
        program.options.flatMap(option => [option.short, option.long])
      );
      const walk = (command: Command): string[] =>
        command.commands.flatMap(sub => [
          ...sub.options
            .flatMap(option => [option.short, option.long])
            .filter(flag => flag !== undefined && globalFlags.has(flag))
            .map(flag => `${sub.name()} ${flag}`),
          ...walk(sub),
        ]);
      expect(walk(program)).toEqual([]);
    });
  });

  it("exposes the global AWS options", () => {
    const flags = buildProgram().options.map(option => option.long);
    expect(flags).toEqual(
      expect.arrayContaining(["--profile", "--region", "--dry-run", "--yes"])
    );
  });
});
