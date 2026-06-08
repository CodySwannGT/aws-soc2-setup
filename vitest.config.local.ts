/**
 * Vitest Configuration - Project-Local Customizations
 *
 * Add project-specific Vitest settings here. This file is create-only,
 * meaning Lisa will create it but never overwrite your customizations.
 *
 * Example:
 * ```ts
 * import type { ViteUserConfig } from "vitest/config";
 *
 * const config: ViteUserConfig = {
 *   resolve: {
 *     alias: {
 *       "@/": new URL("./src/", import.meta.url).pathname,
 *     },
 *   },
 * };
 *
 * export default config;
 * ```
 *
 * @see https://vitest.dev/config/
 * @module vitest.config.local
 */
import type { ViteUserConfig } from "vitest/config";

// NOTE: lisa's mergeVitestConfigs does not deep-merge nested coverage arrays,
// so a local `coverage.exclude` set here is dropped. Keep untested wiring out
// of coverage by extracting logic into tested modules (e.g. src/program.ts)
// and leaving a thin src/cli.ts runner — not by relying on an exclude override.
const config: ViteUserConfig = {
  // Add project-specific settings here
};

export default config;
