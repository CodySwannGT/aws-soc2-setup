import { createRequire } from "module";

import { describe, expect, it } from "vitest";

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

  it("exposes the global AWS options", () => {
    const flags = buildProgram().options.map(option => option.long);
    expect(flags).toEqual(
      expect.arrayContaining(["--profile", "--region", "--dry-run", "--yes"])
    );
  });
});
