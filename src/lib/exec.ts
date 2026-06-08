import { spawn as nodeSpawn } from "node:child_process";

import { CliError } from "./errors.js";

/** The subset of `child_process.spawn` this module depends on (injectable for tests). */
export type SpawnFn = typeof nodeSpawn;

/**
 * Run an interactive command, inheriting the parent's stdio so the user can
 * respond to prompts (e.g. the `aws configure sso` wizard). Resolves on a clean
 * exit and rejects otherwise.
 * @param command - The executable to run.
 * @param args - Arguments to pass to the command.
 * @param spawn - Spawn implementation; defaults to Node's, overridable in tests.
 * @returns A promise that resolves when the command exits with code 0.
 */
export const runInteractive = (
  command: string,
  args: string[],
  spawn: SpawnFn = nodeSpawn
): Promise<void> =>
  new Promise((resolve, reject) => {
    const child = spawn(command, args, { stdio: "inherit" });
    child.on("error", error => {
      reject(error);
    });
    child.on("close", code => {
      if (code === 0) {
        resolve();
        return;
      }
      reject(new CliError(`${command} exited with code ${code ?? "unknown"}`));
    });
  });
