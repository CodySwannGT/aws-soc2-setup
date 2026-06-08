import type { Command } from "commander";

import { info } from "../lib/logger.js";

/**
 * Register the `status` command on the given program.
 * @param program - The root commander program to attach the command to.
 */
export const registerStatus = (program: Command): void => {
  program
    .command("status")
    .description("Show the scaffold status of the CLI")
    .action(() => {
      info(
        "aws-soc2-setup CLI scaffolded. AWS domain commands land in subsequent phases."
      );
    });
};
