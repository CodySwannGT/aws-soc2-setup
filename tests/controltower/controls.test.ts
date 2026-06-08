import { describe, expect, it } from "vitest";

import {
  buildOuArn,
  controlIdentifierFormats,
  describeControl,
  extractOuId,
  isValidOuId,
  selectControls,
} from "../../src/controltower/controls.js";

const BARE_OU = "ou-abcd-12345678";
const REGION = "us-east-1";
const CONFIG_CONTROL = "AWS-GR_CONFIG_ENABLED";

describe("isValidOuId", () => {
  it("accepts bare id, path, and ARN forms", () => {
    expect(isValidOuId(BARE_OU)).toBe(true);
    expect(isValidOuId(`r-abcd/${BARE_OU}`)).toBe(true);
    expect(
      isValidOuId(`arn:aws:organizations::123456789012:ou/o-abc/${BARE_OU}`)
    ).toBe(true);
  });

  it("rejects garbage", () => {
    expect(isValidOuId("not-an-ou")).toBe(false);
  });
});

describe("extractOuId", () => {
  it("pulls the bare id from a path", () => {
    expect(extractOuId(`r-abcd/${BARE_OU}`)).toBe(BARE_OU);
  });

  it("returns the input when no id is present", () => {
    expect(extractOuId("nothing")).toBe("nothing");
  });
});

describe("selectControls", () => {
  it("minimal/type1 returns only the four minimal type1 controls", () => {
    expect(selectControls("type1", "minimal")).toHaveLength(4);
  });

  it("recommended/both includes minimal and recommended for both types", () => {
    const controls = selectControls("both", "recommended");
    expect(controls).toContain("AWS-GR_ROOT_ACCOUNT_MFA_ENABLED");
    expect(controls).toContain(CONFIG_CONTROL);
    expect(controls).toContain("AWS-GR_S3_BUCKET_PUBLIC_READ_PROHIBITED");
  });

  it("comprehensive is a superset of recommended", () => {
    const recommended = selectControls("both", "recommended");
    const comprehensive = selectControls("both", "comprehensive");
    expect(comprehensive.length).toBeGreaterThan(recommended.length);
  });

  it("returns a sorted, de-duplicated list", () => {
    const controls = selectControls("both", "comprehensive");
    expect(controls).toEqual([...controls].sort((a, b) => a.localeCompare(b)));
    expect(new Set(controls).size).toBe(controls.length);
  });
});

describe("buildOuArn", () => {
  it("composes the organizations OU ARN", () => {
    expect(buildOuArn("123456789012", "o-abc", BARE_OU)).toBe(
      `arn:aws:organizations::123456789012:ou/o-abc/${BARE_OU}`
    );
  });
});

describe("controlIdentifierFormats", () => {
  it("prefers the Control Tower regional ARN for confirmed controls", () => {
    const formats = controlIdentifierFormats(CONFIG_CONTROL, REGION);
    expect(formats[0]).toBe(
      "arn:aws:controltower:us-east-1::control/AWS-GR_CONFIG_ENABLED"
    );
  });

  it("prefers the Control Catalog ARN for S3 controls", () => {
    const formats = controlIdentifierFormats(
      "AWS-GR_S3_BUCKET_PUBLIC_READ_PROHIBITED",
      REGION
    );
    expect(formats[0]).toContain("controlcatalog");
  });

  it("falls back to the regional ARN for unknown controls", () => {
    const formats = controlIdentifierFormats("AWS-GR_UNKNOWN", "eu-west-1");
    expect(formats[0]).toBe(
      "arn:aws:controltower:eu-west-1::control/AWS-GR_UNKNOWN"
    );
  });
});

describe("describeControl", () => {
  it("returns the known description", () => {
    expect(describeControl(CONFIG_CONTROL)).toBe("Enable AWS Config");
  });

  it("falls back for unknown controls", () => {
    expect(describeControl("AWS-GR_NOPE")).toContain("Unknown");
  });
});
