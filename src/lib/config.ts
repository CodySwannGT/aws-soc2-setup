import { CliError } from "./errors.js";

/**
 * Flags accepted on the command line that influence every AWS operation. All
 * optional — missing values fall back to environment variables then defaults.
 */
export interface GlobalFlags {
  profile?: string;
  region?: string;
  dryRun?: boolean;
  yes?: boolean;
}

/**
 * Fully resolved global options, with every field populated. This is what
 * domain commands consume rather than reading the environment themselves.
 */
export interface GlobalOptions {
  profile?: string;
  region: string;
  dryRun: boolean;
  yes: boolean;
}

const DEFAULT_REGION = "us-east-1";

/**
 * Merge command-line flags with environment variables and defaults into a
 * single resolved options object. Precedence: explicit flag, then environment,
 * then built-in default. Mirrors how the bash scripts read `-p`/`-r` ahead of
 * `AWS_PROFILE`/`AWS_REGION`.
 *
 * `npm exec aws-soc2-setup ... --dry-run` (without `--`) makes npm consume
 * `--dry-run` as its own flag; npm then exposes it as `npm_config_dry_run`.
 * That is honored so the run stays a preview. npm's `--yes` is deliberately
 * NOT honored: it also means "auto-install" (`npx --yes`) and must never
 * confirm a destructive operation.
 * @param flags - Flags parsed from the command line.
 * @param env - Environment to read from; defaults to `process.env`.
 * @returns The resolved global options.
 */
export const resolveGlobalOptions = (
  flags: GlobalFlags,
  env: NodeJS.ProcessEnv = process.env
): GlobalOptions => ({
  profile: flags.profile ?? env.AWS_PROFILE,
  region:
    flags.region ?? env.AWS_REGION ?? env.AWS_DEFAULT_REGION ?? DEFAULT_REGION,
  dryRun: flags.dryRun ?? env.npm_config_dry_run === "true",
  yes: flags.yes ?? false,
});

const NPM_SWALLOWED_YES_HINT =
  " npm consumed --yes as its own flag before the CLI received it; run" +
  " `npx aws-soc2-setup ...` or `npm exec -- aws-soc2-setup ...` instead.";

/**
 * Refuse a destructive operation unless `--yes` was given. When the CLI was
 * launched by `npm exec` and npm swallowed `--yes`, the refusal says so.
 * @param globals - Resolved global options.
 * @param action - Description of the operation, for the error message.
 * @param env - Environment to inspect; defaults to `process.env`.
 * @throws {CliError} If the operation was not confirmed.
 */
export const requireConfirmation = (
  globals: Pick<GlobalOptions, "yes">,
  action: string,
  env: NodeJS.ProcessEnv = process.env
): void => {
  if (globals.yes) {
    return;
  }
  const npmAteYes = env.npm_command === "exec" && env.npm_config_yes === "true";
  throw new CliError(
    `Refusing to ${action} without confirmation. Re-run with --yes to proceed.${
      npmAteYes ? NPM_SWALLOWED_YES_HINT : ""
    }`
  );
};
