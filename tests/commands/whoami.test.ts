import { GetCallerIdentityCommand, STSClient } from "@aws-sdk/client-sts";
import { mockClient } from "aws-sdk-client-mock";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { buildProgram } from "../../src/program.js";

const stsMock = mockClient(STSClient);

const ACCOUNT = "123456789012";
const USER_ID = "AIDAEXAMPLE";
const ARGV = ["node", "aws-soc2-setup", "whoami"];

describe("whoami command", () => {
  const originalExitCode = process.exitCode;

  beforeEach(() => {
    stsMock.reset();
  });

  afterEach(() => {
    process.exitCode = originalExitCode;
    vi.restoreAllMocks();
  });

  it("prints the resolved caller identity to stdout", async () => {
    stsMock.on(GetCallerIdentityCommand).resolves({
      Account: ACCOUNT,
      Arn: "arn:aws:iam::123456789012:user/admin",
      UserId: USER_ID,
    });
    const out = vi.spyOn(process.stdout, "write").mockReturnValue(true);

    await buildProgram().parseAsync(ARGV);

    const printed = out.mock.calls.map(call => String(call[0])).join("");
    expect(printed).toContain(ACCOUNT);
    expect(printed).toContain(USER_ID);
  });

  it("reports an error and sets a non-zero exit code on failure", async () => {
    stsMock.on(GetCallerIdentityCommand).resolves({ Account: ACCOUNT });
    const err = vi.spyOn(process.stderr, "write").mockReturnValue(true);

    await buildProgram().parseAsync(ARGV);

    expect(process.exitCode).not.toBe(0);
    expect(err).toHaveBeenCalled();
  });
});
