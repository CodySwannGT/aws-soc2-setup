import { EventEmitter } from "node:events";

import { describe, expect, it } from "vitest";

import { runInteractive, type SpawnFn } from "../../src/lib/exec.js";
import { CliError } from "../../src/lib/errors.js";

const fakeSpawn = (emitter: EventEmitter): SpawnFn =>
  (() => emitter) as unknown as SpawnFn;

describe("runInteractive", () => {
  it("resolves when the process exits with code 0", async () => {
    const emitter = new EventEmitter();
    const promise = runInteractive("aws", ["--version"], fakeSpawn(emitter));
    emitter.emit("close", 0);
    await expect(promise).resolves.toBeUndefined();
  });

  it("rejects with CliError on a non-zero exit code", async () => {
    const emitter = new EventEmitter();
    const promise = runInteractive("aws", ["configure"], fakeSpawn(emitter));
    emitter.emit("close", 2);
    await expect(promise).rejects.toBeInstanceOf(CliError);
  });

  it("rejects when the process emits an error", async () => {
    const emitter = new EventEmitter();
    const promise = runInteractive("missing", [], fakeSpawn(emitter));
    const failure = new Error("ENOENT");
    emitter.emit("error", failure);
    await expect(promise).rejects.toBe(failure);
  });
});
