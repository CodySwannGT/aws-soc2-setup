import { describe, expect, it } from "vitest";

import { applyStartUrl, computeStartUrl } from "../../src/sso/config-file.js";

const URL = "https://acme.awsapps.com/start";
const DOMAIN = "acme";
const PROFILE = "admin";
const PROFILE_SECTION = `[profile ${PROFILE}]`;
const START_URL_LINE = `sso_start_url = ${URL}`;

describe("computeStartUrl", () => {
  it("builds the awsapps start URL from a domain", () => {
    expect(computeStartUrl(DOMAIN)).toBe(URL);
  });
});

describe("applyStartUrl", () => {
  it("updates the sso-session section when the profile uses one", () => {
    const config = [
      PROFILE_SECTION,
      "sso_session = my-sso",
      "region = us-east-1",
      "",
      "[sso-session my-sso]",
      "sso_start_url = https://old.awsapps.com/start",
      "sso_region = us-east-1",
    ].join("\n");

    const result = applyStartUrl(config, PROFILE, DOMAIN);

    expect(result.targetSection).toBe("sso-session my-sso");
    expect(result.url).toBe(URL);
    expect(result.content).toContain(START_URL_LINE);
    expect(result.content).not.toContain("old.awsapps.com");
  });

  it("updates the profile section directly when there is no sso_session", () => {
    const config = [PROFILE_SECTION, "sso_start_url = https://old/start"].join(
      "\n"
    );

    const result = applyStartUrl(config, PROFILE, DOMAIN);

    expect(result.targetSection).toBe("profile admin");
    expect(result.content).toContain(START_URL_LINE);
  });

  it("targets the default section for the default profile", () => {
    const result = applyStartUrl(
      "[default]\nregion = us-east-1",
      "default",
      DOMAIN
    );
    expect(result.targetSection).toBe("default");
    expect(result.content).toContain(START_URL_LINE);
  });

  it("appends a section when it is missing entirely", () => {
    const result = applyStartUrl("", PROFILE, DOMAIN);
    expect(result.content).toContain(PROFILE_SECTION);
    expect(result.content).toContain(START_URL_LINE);
  });
});
