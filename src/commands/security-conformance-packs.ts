import type { Command } from "commander";

import type { GlobalOptions } from "../lib/config.js";
import { CliError } from "../lib/errors.js";
import { info } from "../lib/logger.js";
import { runAction } from "../lib/run.js";
import {
  CONFORMANCE_PACK_CATALOG,
  deployConformancePacks,
  RECOMMENDED_PACK_IDS,
  resolveConformancePacks,
} from "../security/conformance-packs.js";

/** Options for `security conformance-packs`. */
export interface ConformancePacksOptions {
  preset?: string;
  packs?: string[];
  list?: boolean;
}

const listPacks = (): void => {
  info("Available conformance packs (AWS sample templates):");
  for (const pack of CONFORMANCE_PACK_CATALOG) {
    info(`  ${pack.id} — ${pack.description} → ${pack.conformancePackName}`);
  }
  info(
    `Recommended preset: ${RECOMMENDED_PACK_IDS.join(", ")} (no official SOC 2 pack exists)`
  );
};

const resolveSelection = (
  options: ConformancePacksOptions
): ReturnType<typeof resolveConformancePacks> => {
  if (options.preset === "recommended") {
    return resolveConformancePacks(RECOMMENDED_PACK_IDS);
  }
  if (options.preset) {
    throw new CliError(
      `Unknown preset '${options.preset}'. Supported: recommended`
    );
  }
  if (options.packs && options.packs.length > 0) {
    return resolveConformancePacks(options.packs);
  }
  throw new CliError(
    "Select packs with --preset recommended or --packs <id...>. Use --list to see ids."
  );
};

/**
 * Execute `security conformance-packs`: deploy AWS Config sample conformance
 * packs as an Audit Manager alternative for technical evidence. Honors
 * `--dry-run`.
 * @param globals - Resolved global options.
 * @param options - Preset, explicit pack ids, or --list.
 * @param deploy - Injectable deployer (defaults to live AWS + GitHub fetch).
 */
export const handleConformancePacks = async (
  globals: GlobalOptions,
  options: ConformancePacksOptions,
  deploy: typeof deployConformancePacks = deployConformancePacks
): Promise<void> => {
  if (options.list) {
    listPacks();
    return;
  }
  const packs = resolveSelection(options);
  if (globals.dryRun) {
    info(
      `[dry-run] Would deploy conformance packs: ${packs.map(pack => pack.id).join(", ")}`
    );
    return;
  }
  info(
    "Deploying AWS Config Conformance Packs (sample templates; not a SOC 2 certification)."
  );
  await deploy(globals, packs);
};

/**
 * Register `security conformance-packs`.
 * @param security - The security command group.
 * @param globals - Resolver for global options from the root program.
 */
export const registerConformancePacks = (
  security: Command,
  globals: () => GlobalOptions
): void => {
  security
    .command("conformance-packs")
    .description(
      "Deploy AWS Config Conformance Packs (Audit Manager alternative; no SOC 2 pack)"
    )
    .option(
      "--preset <name>",
      "Pack preset (recommended = cis-level1, wa-security, ct-detective)"
    )
    .option("--packs <ids...>", "One or more pack ids (see --list)")
    .option("--list", "List available pack ids and exit")
    .action(async (options: ConformancePacksOptions) => {
      await runAction(async () => {
        await handleConformancePacks(globals(), options);
      });
    });
};
