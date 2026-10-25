import { describe, expect, it } from "vitest";

import { requireConfirmation } from "../../src/lib/config.js";
import { CliError } from "../../src/lib/errors.js";

const ACTION = "remove root access org-wide";

describe("requireConfirmation", () => {
  it("passes when --yes was given", () => {
    expect(() => requireConfirmation({ yes: true }, ACTION, {})).not.toThrow();
  });

  it("refuses without --yes", () => {
    expect(() => requireConfirmation({ yes: false }, ACTION, {})).toThrow(
      CliError
    );
  });

  it("explains when npm exec consumed --yes before the CLI saw it", () => {
    expect(() =>
      requireConfirmation({ yes: false }, ACTION, {
        npm_command: "exec",
        npm_config_yes: "true",
      })
    ).toThrow(/npm exec -- aws-soc2-setup/);
  });

  it("omits the npm hint for ordinary invocations", () => {
    expect(() => requireConfirmation({ yes: false }, ACTION, {})).toThrow(
      /^Refusing to remove root access org-wide without confirmation\. Re-run with --yes to proceed\.$/
    );
  });
});
