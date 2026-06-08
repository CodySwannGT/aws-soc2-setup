import { readFile, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";

import type { Command } from "commander";

import { runInteractive } from "../lib/exec.js";
import { info, success } from "../lib/logger.js";
import { runAction } from "../lib/run.js";
import { applyStartUrl } from "../sso/config-file.js";

/** Options for `sso set-start-url`. */
export interface SetStartUrlOptions {
  profile: string;
  domain: string;
  configPath?: string;
}

const defaultConfigPath = (): string => join(homedir(), ".aws", "config");

/**
 * Execute `sso configure-profile`: run the interactive `aws configure sso` wizard.
 * @param run - Interactive runner; defaults to the real one, injectable for tests.
 */
export const handleConfigureProfile = async (
  run: typeof runInteractive = runInteractive
): Promise<void> => {
  await run("aws", ["configure", "sso"]);
  info("SSO profile configured. Log in with: aws sso login --profile <name>");
};

/**
 * Execute `sso set-start-url`: rewrite the SSO start URL in the AWS CLI config.
 * @param options - The profile, domain, and optional config path.
 */
export const handleSetStartUrl = async (
  options: SetStartUrlOptions
): Promise<void> => {
  const path = options.configPath ?? defaultConfigPath();
  const original = await readFile(path, "utf8");
  const update = applyStartUrl(original, options.profile, options.domain);
  await writeFile(path, update.content, "utf8");
  success(`Updated [${update.targetSection}] sso_start_url to ${update.url}`);
};

/**
 * Register the local-config SSO subcommands (configure-profile, set-start-url)
 * on the given `sso` command.
 * @param sso - The `sso` parent command to attach the subcommands to.
 */
export const registerSsoConfigCommands = (sso: Command): void => {
  sso
    .command("configure-profile")
    .description("Run the interactive `aws configure sso` wizard")
    .action(async () => {
      await runAction(async () => {
        await handleConfigureProfile();
      });
    });

  sso
    .command("set-start-url")
    .description("Update the SSO start URL in your AWS CLI config")
    .requiredOption("-p, --profile <profile>", "AWS CLI profile to update")
    .requiredOption(
      "-d, --domain <domain>",
      "Identity Center domain (without https:// or /start)"
    )
    .action(async (options: SetStartUrlOptions) => {
      await runAction(async () => {
        await handleSetStartUrl(options);
      });
    });
};
