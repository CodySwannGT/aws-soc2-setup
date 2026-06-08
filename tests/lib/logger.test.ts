import { afterEach, describe, expect, it, vi } from "vitest";

import {
  error,
  formatMessage,
  info,
  log,
  success,
  warn,
  type LogLevel,
} from "../../src/lib/logger.js";

const MESSAGE = "hello world";

describe("formatMessage", () => {
  it.each<[LogLevel]>([["info"], ["success"], ["warn"], ["error"]])(
    "prefixes the message with the %s symbol and preserves the text",
    level => {
      const result = formatMessage(level, MESSAGE);
      expect(result).toContain(MESSAGE);
      // A symbol prefix plus a space precedes the message.
      expect(result.endsWith(` ${MESSAGE}`)).toBe(true);
      expect(result.length).toBeGreaterThan(MESSAGE.length);
    }
  );
});

describe("log", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("writes non-error levels to stdout", () => {
    const out = vi.spyOn(process.stdout, "write").mockReturnValue(true);
    const err = vi.spyOn(process.stderr, "write").mockReturnValue(true);

    log("info", "to stdout");

    expect(out).toHaveBeenCalledTimes(1);
    expect(err).not.toHaveBeenCalled();
    expect(out.mock.calls[0]?.[0]).toContain("to stdout");
    expect(out.mock.calls[0]?.[0]).toMatch(/\n$/);
  });

  it("routes error level to stderr", () => {
    const out = vi.spyOn(process.stdout, "write").mockReturnValue(true);
    const err = vi.spyOn(process.stderr, "write").mockReturnValue(true);

    log("error", "to stderr");

    expect(err).toHaveBeenCalledTimes(1);
    expect(out).not.toHaveBeenCalled();
    expect(err.mock.calls[0]?.[0]).toContain("to stderr");
  });
});

describe("level helpers", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("info/success/warn write to stdout and error writes to stderr", () => {
    const out = vi.spyOn(process.stdout, "write").mockReturnValue(true);
    const err = vi.spyOn(process.stderr, "write").mockReturnValue(true);

    info("i");
    success("s");
    warn("w");
    error("e");

    expect(out).toHaveBeenCalledTimes(3);
    expect(err).toHaveBeenCalledTimes(1);
  });
});
