/**
 * Error type for expected, user-facing failures (bad input, missing AWS
 * resources, denied permissions). Carries the process exit code the CLI should
 * exit with. Unexpected errors are left to bubble as generic failures.
 */
export class CliError extends Error {
  readonly exitCode: number;

  /**
   * Create a user-facing CLI error.
   * @param message - Human-readable explanation shown to the user.
   * @param exitCode - Process exit code to surface; defaults to 1.
   */
  constructor(message: string, exitCode = 1) {
    super(message);
    this.name = "CliError";
    this.exitCode = exitCode;
  }
}
