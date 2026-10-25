import { describe, expect, it } from "vitest";

import { resolveGlobalOptions } from "../../src/lib/config.js";

const REGION = "eu-west-1";
const PROFILE = "my-profile";

describe("resolveGlobalOptions", () => {
  it("prefers explicit flags over environment and defaults", () => {
    const opts = resolveGlobalOptions(
      { profile: PROFILE, region: REGION, dryRun: true, yes: true },
      { AWS_PROFILE: "env-profile", AWS_REGION: "us-east-2" }
    );
    expect(opts).toEqual({
      profile: PROFILE,
      region: REGION,
      dryRun: true,
      yes: true,
    });
  });

  it("honors a --dry-run that npm exec consumed as its own flag", () => {
    const opts = resolveGlobalOptions(
      {},
      { npm_command: "exec", npm_config_dry_run: "true" }
    );
    expect(opts.dryRun).toBe(true);
  });

  it("never treats npm's --yes as confirmation", () => {
    const opts = resolveGlobalOptions(
      {},
      { npm_command: "exec", npm_config_yes: "true" }
    );
    expect(opts.yes).toBe(false);
  });

  it("falls back to environment variables when flags are absent", () => {
    const opts = resolveGlobalOptions(
      {},
      { AWS_PROFILE: PROFILE, AWS_REGION: REGION }
    );
    expect(opts.profile).toBe(PROFILE);
    expect(opts.region).toBe(REGION);
  });

  it("uses AWS_DEFAULT_REGION when AWS_REGION is unset", () => {
    expect(
      resolveGlobalOptions({}, { AWS_DEFAULT_REGION: REGION }).region
    ).toBe(REGION);
  });

  it("defaults region to us-east-1 and flags to false when nothing is set", () => {
    expect(resolveGlobalOptions({}, {})).toEqual({
      profile: undefined,
      region: "us-east-1",
      dryRun: false,
      yes: false,
    });
  });
});
