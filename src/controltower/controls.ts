import {
  CONTROL_CATALOG_FORMAT_CONTROLS,
  CONTROL_DESCRIPTIONS,
  CONTROL_SETS,
  CONTROL_TOWER_FORMAT_CONTROLS,
  type ControlBaseline,
  type Soc2Type,
} from "./control-catalog.js";

const OU_ID_PATTERN = /(ou-[a-z0-9]{4}-[a-z0-9]{8})/;

/**
 * Validate that an OU identifier is one of the accepted forms (bare id, path,
 * or full ARN).
 * @param ouId - The OU identifier to validate.
 * @returns True if it contains a well-formed OU id.
 */
export const isValidOuId = (ouId: string): boolean =>
  /^ou-[a-z0-9]{4}-[a-z0-9]{8}$/.test(ouId) ||
  ouId.startsWith("arn:aws:organizations::") ||
  /\/ou-[a-z0-9]{4}-[a-z0-9]{8}$/.test(ouId);

/**
 * Extract the bare `ou-xxxx-xxxxxxxx` id from any accepted OU identifier form.
 * @param ouId - The OU identifier (bare, path, or ARN).
 * @returns The bare OU id, or the input unchanged if no match.
 */
export const extractOuId = (ouId: string): string =>
  OU_ID_PATTERN.exec(ouId)?.[1] ?? ouId;

const baselineLevels = (baseline: ControlBaseline): ControlBaseline[] => {
  if (baseline === "minimal") {
    return ["minimal"];
  }
  if (baseline === "recommended") {
    return ["minimal", "recommended"];
  }
  return ["minimal", "recommended", "comprehensive"];
};

const typesFor = (soc2Type: Soc2Type): ("type1" | "type2")[] => {
  if (soc2Type === "type1") {
    return ["type1"];
  }
  if (soc2Type === "type2") {
    return ["type2"];
  }
  return ["type1", "type2"];
};

/**
 * Resolve the deduplicated, sorted set of control ids for a SOC 2 type and
 * baseline (minimal ⊂ recommended ⊂ comprehensive).
 * @param soc2Type - The SOC 2 type to target.
 * @param baseline - The control baseline depth.
 * @returns The sorted, unique control ids.
 */
export const selectControls = (
  soc2Type: Soc2Type,
  baseline: ControlBaseline
): string[] => {
  const levels = baselineLevels(baseline);
  const types = typesFor(soc2Type);
  const ids = levels.flatMap(level =>
    types.flatMap(type => CONTROL_SETS[level][type])
  );
  return [...new Set(ids)].sort((a, b) => a.localeCompare(b));
};

/**
 * Build the full OU target ARN expected by Control Tower `enable-control`.
 * @param accountId - The management account id.
 * @param organizationId - The organization id (`o-...`).
 * @param ouId - The bare OU id.
 * @returns The target identifier ARN.
 */
export const buildOuArn = (
  accountId: string,
  organizationId: string,
  ouId: string
): string => `arn:aws:organizations::${accountId}:ou/${organizationId}/${ouId}`;

/**
 * Get the human-readable description for a control id.
 * @param controlId - The control id.
 * @returns The description, or a generic fallback.
 */
export const describeControl = (controlId: string): string =>
  CONTROL_DESCRIPTIONS[controlId] ?? `Unknown control: ${controlId}`;

const specialArn = (controlId: string): string | undefined => {
  if (CONTROL_TOWER_FORMAT_CONTROLS.has(controlId)) {
    return `arn:aws:controltower:us-east-1::control/${controlId}`;
  }
  if (CONTROL_CATALOG_FORMAT_CONTROLS.has(controlId)) {
    return `arn:aws:controlcatalog:::control/${controlId}`;
  }
  return undefined;
};

/**
 * Build the ordered list of control-identifier formats to try for a control,
 * preferring known-good formats first (matching the bash fallback order).
 * @param controlId - The control id.
 * @param region - The AWS region for the regional Control Tower ARN.
 * @returns The ordered, de-duplicated identifier candidates.
 */
export const controlIdentifierFormats = (
  controlId: string,
  region: string
): string[] => {
  const regionalArn = `arn:aws:controltower:${region}::control/${controlId}`;
  const candidates = [
    specialArn(controlId),
    regionalArn,
    controlId,
    `arn:aws:controlcatalog:::control/${controlId}`,
    regionalArn,
  ].filter((value): value is string => Boolean(value));
  return [...new Set(candidates)];
};
