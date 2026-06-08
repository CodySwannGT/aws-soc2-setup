import { Command } from "commander";
import { afterEach, describe, expect, it, vi } from "vitest";

import { registerStatus } from "../../src/commands/status.js";

describe("registerStatus", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("registers a status command that writes to stdout", () => {
    const program = new Command();
    registerStatus(program);
    const out = vi.spyOn(process.stdout, "write").mockReturnValue(true);

    program.parse(["node", "cli", "status"]);

    expect(out).toHaveBeenCalledTimes(1);
    expect(out.mock.calls[0]?.[0]).toContain("scaffolded");
  });
});
