import type { Command } from "commander";

import { resolveGlobalOptions, type GlobalFlags } from "../lib/config.js";
import { info } from "../lib/logger.js";
import { runAction } from "../lib/run.js";
import { getCallerIdentity } from "../lib/sts.js";

/**
 * Register the `whoami` command, which prints the AWS caller identity for the
 * resolved profile/region — the preflight check ported from the bash scripts.
 * @param program - The root commander program to attach the command to.
 */
export const registerWhoami = (program: Command): void => {
  program
    .command("whoami")
    .description(
      "Print the AWS caller identity for the resolved profile/region"
    )
    .action(async () => {
      await runAction(async () => {
        const options = resolveGlobalOptions(program.opts<GlobalFlags>());
        const identity = await getCallerIdentity(options);
        info(`Account: ${identity.account}`);
        info(`ARN:     ${identity.arn}`);
        info(`User ID: ${identity.userId}`);
      });
    });
};
