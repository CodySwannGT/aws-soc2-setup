import { CliError } from "./errors.js";
import { error } from "./logger.js";

/**
 * Execute a command action with uniform error handling. Expected failures
 * (`CliError`) print a clean message and set the matching exit code; any other
 * error prints its message and exits 1. Replaces the repeated `if [ $? -ne 0 ]`
 * blocks scattered through the bash scripts.
 * @param action - The asynchronous command body to run.
 */
export const runAction = async (action: () => Promise<void>): Promise<void> => {
  try {
    await action();
  } catch (caught) {
    if (caught instanceof CliError) {
      error(caught.message);
      process.exitCode = caught.exitCode;
      return;
    }
    error(caught instanceof Error ? caught.message : String(caught));
    process.exitCode = 1;
  }
};
