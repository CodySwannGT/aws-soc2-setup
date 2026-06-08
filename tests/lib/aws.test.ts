import { describe, expect, it } from "vitest";

import { buildClientConfig } from "../../src/lib/aws.js";

const REGION = "us-west-2";

describe("buildClientConfig", () => {
  it("sets the region and omits credentials when no profile is given", () => {
    const config = buildClientConfig({ region: REGION });
    expect(config.region).toBe(REGION);
    expect(config.credentials).toBeUndefined();
  });

  it("provides a credentials provider when a profile is given", () => {
    const config = buildClientConfig({ region: REGION, profile: "admin" });
    expect(config.region).toBe(REGION);
    expect(typeof config.credentials).toBe("function");
  });
});
