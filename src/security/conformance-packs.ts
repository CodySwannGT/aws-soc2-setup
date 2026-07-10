import {
  ConfigServiceClient,
  DescribeConformancePacksCommand,
  PutConformancePackCommand,
} from "@aws-sdk/client-config-service";

import { buildClientConfig } from "../lib/aws.js";
import { CliError } from "../lib/errors.js";
import { info, success, warn } from "../lib/logger.js";

import type { SecurityContext } from "./config.js";

/** GitHub path for AWS sample conformance pack templates. */
export const CONFORMANCE_PACK_TEMPLATE_BASE =
  "https://raw.githubusercontent.com/awslabs/aws-config-rules/master/aws-config-conformance-packs";

/** A known sample pack the CLI can deploy. */
export interface ConformancePackDefinition {
  id: string;
  conformancePackName: string;
  templateFile: string;
  description: string;
}

/**
 * SOC 2–oriented sample packs. There is no official SOC 2 Conformance Pack;
 * these are the closest AWS-published technical baselines.
 */
export const CONFORMANCE_PACK_CATALOG: readonly ConformancePackDefinition[] = [
  {
    id: "cis-level1",
    conformancePackName: "SOC2-CIS-AWS-Foundations-Level1",
    templateFile: "Operational-Best-Practices-for-CIS-AWS-v1.4-Level1.yaml",
    description: "CIS AWS Foundations Benchmark v1.4 Level 1",
  },
  {
    id: "cis-level2",
    conformancePackName: "SOC2-CIS-AWS-Foundations-Level2",
    templateFile: "Operational-Best-Practices-for-CIS-AWS-v1.4-Level2.yaml",
    description: "CIS AWS Foundations Benchmark v1.4 Level 2",
  },
  {
    id: "wa-security",
    conformancePackName: "SOC2-WA-Security-Pillar",
    templateFile:
      "Operational-Best-Practices-for-AWS-Well-Architected-Security-Pillar.yaml",
    description: "AWS Well-Architected Framework Security Pillar",
  },
  {
    id: "ct-detective",
    conformancePackName: "SOC2-Control-Tower-Detective-Guardrails",
    templateFile: "AWS-Control-Tower-Detective-Guardrails.yaml",
    description: "AWS Control Tower detective guardrails (Config rules)",
  },
];

/** Default preset for SOC 2–oriented technical evidence after Audit Manager. */
export const RECOMMENDED_PACK_IDS = [
  "cis-level1",
  "wa-security",
  "ct-detective",
] as const;

const TEMPLATE_BODY_MAX_BYTES = 51_200;

const configClient = (context: SecurityContext): ConfigServiceClient =>
  new ConfigServiceClient(buildClientConfig(context));

/**
 * Resolve catalog entries by id. Unknown ids throw.
 * @param ids - Pack ids from the catalog.
 * @returns Matching definitions in catalog order.
 */
export const resolveConformancePacks = (
  ids: readonly string[]
): ConformancePackDefinition[] => {
  const byId = new Map(
    CONFORMANCE_PACK_CATALOG.map(pack => [pack.id, pack] as const)
  );
  return ids.map(id => {
    const pack = byId.get(id);
    if (!pack) {
      const known = CONFORMANCE_PACK_CATALOG.map(entry => entry.id).join(", ");
      throw new CliError(
        `Unknown conformance pack '${id}'. Known packs: ${known}`
      );
    }
    return pack;
  });
};

/**
 * Fetch a sample template body from the awslabs GitHub repo.
 * @param templateFile - Filename under aws-config-conformance-packs/.
 * @param fetchImpl - Injectable fetch (defaults to global fetch).
 * @returns The YAML template body.
 */
export const fetchConformancePackTemplate = async (
  templateFile: string,
  fetchImpl: typeof fetch = fetch
): Promise<string> => {
  const url = `${CONFORMANCE_PACK_TEMPLATE_BASE}/${templateFile}`;
  const response = await fetchImpl(url);
  if (!response.ok) {
    throw new CliError(
      `Failed to download conformance pack template ${templateFile} (${response.status}).`
    );
  }
  const body = await response.text();
  const bytes = Buffer.byteLength(body, "utf8");
  if (bytes > TEMPLATE_BODY_MAX_BYTES) {
    throw new CliError(
      `Template ${templateFile} is ${bytes} bytes; PutConformancePack TemplateBody max is ${TEMPLATE_BODY_MAX_BYTES}.`
    );
  }
  return body;
};

const packExists = async (
  context: SecurityContext,
  conformancePackName: string
): Promise<boolean> => {
  try {
    const result = await configClient(context).send(
      new DescribeConformancePacksCommand({
        ConformancePackNames: [conformancePackName],
      })
    );
    return (result.ConformancePackDetails ?? []).some(
      pack => pack.ConformancePackName === conformancePackName
    );
  } catch {
    return false;
  }
};

/**
 * Deploy (or refresh) one conformance pack via PutConformancePack.
 * Idempotent: PutConformancePack updates an existing pack of the same name.
 * @param context - AWS region/profile context.
 * @param pack - Catalog definition.
 * @param templateBody - YAML template contents.
 * @returns True if the pack was newly created; false if it already existed.
 */
export const ensureConformancePack = async (
  context: SecurityContext,
  pack: ConformancePackDefinition,
  templateBody: string
): Promise<boolean> => {
  const existed = await packExists(context, pack.conformancePackName);
  await configClient(context).send(
    new PutConformancePackCommand({
      ConformancePackName: pack.conformancePackName,
      TemplateBody: templateBody,
    })
  );
  if (existed) {
    info(
      `Updated conformance pack ${pack.conformancePackName} (${pack.description})`
    );
    return false;
  }
  success(
    `Deployed conformance pack ${pack.conformancePackName} (${pack.description})`
  );
  return true;
};

/**
 * Deploy each selected pack, isolating failures so one bad pack does not stop
 * the rest.
 * @param context - AWS region/profile context.
 * @param packs - Catalog definitions to deploy.
 * @param fetchImpl - Injectable fetch for templates.
 */
export const deployConformancePacks = async (
  context: SecurityContext,
  packs: readonly ConformancePackDefinition[],
  fetchImpl: typeof fetch = fetch
): Promise<void> => {
  for (const pack of packs) {
    try {
      const body = await fetchConformancePackTemplate(
        pack.templateFile,
        fetchImpl
      );
      await ensureConformancePack(context, pack, body);
    } catch (caught) {
      warn(
        `Conformance pack '${pack.id}' failed: ${caught instanceof Error ? caught.message : String(caught)}`
      );
    }
  }
};
