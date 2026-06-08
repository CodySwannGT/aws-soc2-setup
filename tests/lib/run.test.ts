import { afterEach, describe, expect, it, vi } from "vitest";

import { CliError } from "../../src/lib/errors.js";
import { runAction } from "../../src/lib/run.js";

describe("runAction", () => {
  const originalExitCode = process.exitCode;

  afterEach(() => {
    process.exitCode = originalExitCode;
    vi.restoreAllMocks();
  });

  it("runs the action and leaves the exit code untouched on success", async () => {
    const action = vi.fn().mockResolvedValue(undefined);
    await runAction(action);
    expect(action).toHaveBeenCalledTimes(1);
    expect(process.exitCode).toBe(originalExitCode);
  });

  it("uses the CliError exit code and prints its message", async () => {
    const err = vi.spyOn(process.stderr, "write").mockReturnValue(true);
    await runAction(() => {
      throw new CliError("expected failure", 3);
    });
    expect(process.exitCode).toBe(3);
    expect(err.mock.calls[0]?.[0]).toContain("expected failure");
  });

  it("exits 1 on a generic Error", async () => {
    vi.spyOn(process.stderr, "write").mockReturnValue(true);
    await runAction(() => {
      throw new Error("kaboom");
    });
    expect(process.exitCode).toBe(1);
  });

  it("stringifies a non-Error failure value", async () => {
    const err = vi.spyOn(process.stderr, "write").mockReturnValue(true);
    // A library rejecting with a plain value rather than an Error instance.
    const nonError = "raw failure" as unknown as Error;
    await runAction(() => Promise.reject(nonError));
    expect(process.exitCode).toBe(1);
    expect(err.mock.calls[0]?.[0]).toContain("raw failure");
  });
});
