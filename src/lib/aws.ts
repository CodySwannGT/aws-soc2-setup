import { fromIni } from "@aws-sdk/credential-providers";

import type { GlobalOptions } from "./config.js";

/**
 * Shared configuration passed to every AWS SDK v3 client constructor. When a
 * profile is resolved, credentials are sourced from the shared config/credentials
 * files (the same `--profile` behaviour the bash scripts relied on); otherwise
 * the SDK's default credential chain applies.
 */
export interface ClientConfig {
  region: string;
  credentials?: ReturnType<typeof fromIni>;
}

/**
 * Build the SDK client configuration from resolved global options.
 * @param options - The resolved global options (region and optional profile).
 * @returns Client configuration suitable for any `@aws-sdk/client-*` constructor.
 */
export const buildClientConfig = (
  options: Pick<GlobalOptions, "region" | "profile">
): ClientConfig =>
  options.profile
    ? {
        region: options.region,
        credentials: fromIni({ profile: options.profile }),
      }
    : { region: options.region };
