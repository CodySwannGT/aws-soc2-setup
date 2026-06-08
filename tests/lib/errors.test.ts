import { describe, expect, it } from "vitest";

import { CliError } from "../../src/lib/errors.js";

describe("CliError", () => {
  it("defaults the exit code to 1 and is an Error", () => {
    const err = new CliError("boom");
    expect(err).toBeInstanceOf(Error);
    expect(err.message).toBe("boom");
    expect(err.name).toBe("CliError");
    expect(err.exitCode).toBe(1);
  });

  it("accepts a custom exit code", () => {
    expect(new CliError("nope", 2).exitCode).toBe(2);
  });
});
