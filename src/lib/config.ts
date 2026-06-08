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
  dryRun: flags.dryRun ?? false,
  yes: flags.yes ?? false,
});
