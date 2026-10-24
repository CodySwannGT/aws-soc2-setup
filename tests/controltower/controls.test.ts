import { describe, expect, it } from "vitest";

import {
  CONFIG_RULE_CONTROLS,
  LANDING_ZONE_MANDATORY_CONTROLS,
} from "../../src/controltower/control-catalog.js";
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
const S3_PUBLIC_READ = "AWS-GR_S3_BUCKET_PUBLIC_READ_PROHIBITED";

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
    expect(controls).toContain(S3_PUBLIC_READ);
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
    const formats = controlIdentifierFormats("AWS-GR_RESTRICTED_SSH", REGION);
    expect(formats[0]).toBe(
      "arn:aws:controltower:us-east-1::control/AWS-GR_RESTRICTED_SSH"
    );
  });

  it("prefers the Control Catalog ARN for S3 controls", () => {
    const formats = controlIdentifierFormats(S3_PUBLIC_READ, REGION);
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

/**
 * Legacy Control Tower-owned identifiers documented at
 * https://docs.aws.amazon.com/controltower/latest/controlreference/identifiers-for-legacy-controls.html
 * (strongly recommended, elective, and data residency). Any other `AWS-GR_`
 * id does not exist in the Control Catalog.
 */
const DOCUMENTED_LEGACY_CONTROLS = new Set([
  "AWS-GR_EBS_OPTIMIZED_INSTANCE",
  "AWS-GR_ENCRYPTED_VOLUMES",
  "AWS-GR_IAM_USER_MFA_ENABLED",
  "AWS-GR_LAMBDA_FUNCTION_PUBLIC_ACCESS_PROHIBITED",
  "AWS-GR_RDS_STORAGE_ENCRYPTED",
  "AWS-GR_RESTRICTED_COMMON_PORTS",
  "AWS-GR_RESTRICTED_SSH",
  "AWS-GR_RESTRICT_ROOT_USER",
  "AWS-GR_ROOT_ACCOUNT_MFA_ENABLED",
  S3_PUBLIC_READ,
  "AWS-GR_S3_BUCKET_PUBLIC_WRITE_PROHIBITED",
]);

describe("control catalog integrity", () => {
  const all = selectControls("both", "comprehensive");

  it("only uses documented legacy, mandatory, or Config rule ids", () => {
    const unknown = all.filter(
      id =>
        !DOCUMENTED_LEGACY_CONTROLS.has(id) &&
        !LANDING_ZONE_MANDATORY_CONTROLS.has(id) &&
        !CONFIG_RULE_CONTROLS.has(id)
    );
    expect(unknown).toEqual([]);
  });

  it("drops the invented and duplicate identifiers", () => {
    expect(all).not.toContain("AWS-GR_CLOUDTRAIL_LOG_FILE_VALIDATION_ENABLED");
    expect(all).not.toContain("AWS-GR_CLOUD_TRAIL_ENCRYPTION_ENABLED");
    expect(all).not.toContain(
      "AWS-GR_S3_BUCKET_SERVER_SIDE_ENCRYPTION_ENABLED"
    );
    expect(all).not.toContain("AWS-GR_CLOUDWATCH_ALARM_ACTION_CHECK");
  });

  it("maps S3 SSE and CloudTrail checks to AWS Config managed rules", () => {
    expect(all).toContain("S3_BUCKET_SERVER_SIDE_ENCRYPTION_ENABLED");
    expect(all).toContain("CLOUD_TRAIL_ENCRYPTION_ENABLED");
    expect(all).toContain("CLOUD_TRAIL_LOG_FILE_VALIDATION_ENABLED");
  });

  it("marks CloudTrail and Config enablement as landing-zone mandatory", () => {
    expect(
      LANDING_ZONE_MANDATORY_CONTROLS.has("AWS-GR_CLOUDTRAIL_ENABLED")
    ).toBe(true);
    expect(LANDING_ZONE_MANDATORY_CONTROLS.has(CONFIG_CONTROL)).toBe(true);
  });

  it("gives every selected control a unique, known description", () => {
    const descriptions = all.map(describeControl);
    expect(descriptions.filter(text => text.startsWith("Unknown"))).toEqual([]);
    expect(new Set(descriptions).size).toBe(descriptions.length);
  });
});
