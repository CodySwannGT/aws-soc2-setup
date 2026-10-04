import { execFileSync } from "node:child_process";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { afterAll, beforeAll, describe, expect, it } from "vitest";

/**
 * End-to-end checks of the published entrypoint. These build the package with
 * tsup and run `bin/aws-soc2-setup.js` as a real child process, so they cover
 * what the in-process unit tests cannot: the bin → dist wiring, the build
 * output itself, and version resolution from package.json at runtime.
 */
const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..");
const BIN = join(ROOT, "bin", "aws-soc2-setup.js");
const TSUP = join(ROOT, "node_modules", ".bin", "tsup");
const BUILD_TIMEOUT_MS = 120_000;

const runCli = (args: readonly string[], env: NodeJS.ProcessEnv = {}): string =>
  execFileSync(process.execPath, [BIN, ...args], {
    cwd: ROOT,
    encoding: "utf8",
    env: { ...process.env, ...env },
  });

describe("aws-soc2-setup CLI (built entrypoint)", () => {
  const dirs: string[] = [];

  beforeAll(() => {
    execFileSync(TSUP, { cwd: ROOT, stdio: "pipe" });
  }, BUILD_TIMEOUT_MS);

  afterAll(async () => {
    await Promise.all(
      dirs.map(dir => rm(dir, { recursive: true, force: true }))
    );
  });

  it("reports the version declared in package.json", async () => {
    const pkg = JSON.parse(
      await readFile(join(ROOT, "package.json"), "utf8")
    ) as { version: string };

    expect(runCli(["--version"]).trim()).toBe(pkg.version);
  });

  it("exposes every top-level command group in --help", () => {
    const help = runCli(["--help"]);

    for (const command of [
      "status",
      "whoami",
      "kms",
      "backup",
      "sso",
      "security",
      "controltower",
      "root",
      "scp",
      "setup",
    ]) {
      expect(help).toMatch(new RegExp(`^\\s+${command}\\b`, "m"));
    }
  });

  it("rewrites the SSO start URL in the user's AWS config file", async () => {
    const home = await mkdtemp(join(tmpdir(), "soc2-cli-home-"));
    dirs.push(home);
    const configPath = join(home, ".aws", "config");
    await mkdir(dirname(configPath), { recursive: true });
    await writeFile(
      configPath,
      [
        "[profile admin]",
        "sso_start_url = https://old.awsapps.com/start",
        "sso_region = us-east-1",
        "",
        "[profile other]",
        "sso_start_url = https://untouched.awsapps.com/start",
        "",
      ].join("\n"),
      "utf8"
    );

    runCli(["sso", "set-start-url", "--profile", "admin", "--domain", "acme"], {
      HOME: home,
    });

    const written = await readFile(configPath, "utf8");
    expect(written).toContain("sso_start_url = https://acme.awsapps.com/start");
    expect(written).not.toContain("https://old.awsapps.com/start");
    expect(written).toContain(
      "sso_start_url = https://untouched.awsapps.com/start"
    );
    expect(written).toContain("sso_region = us-east-1");
  });
});
