import chalk from "chalk";

/**
 * Severity levels for CLI output. `error` is routed to stderr; everything else
 * to stdout, so machine consumers can separate diagnostics from results.
 */
export type LogLevel = "info" | "success" | "warn" | "error";

const SYMBOLS: Record<LogLevel, string> = {
  info: chalk.blue("ℹ"),
  success: chalk.green("✔"),
  warn: chalk.yellow("⚠"),
  error: chalk.red("✖"),
};

/**
 * Render a log line with its level symbol. Pure — returns the string rather
 * than writing it, so it is trivially testable and reusable.
 * @param level - The severity level whose symbol prefixes the line.
 * @param message - The human-readable text to render.
 * @returns The message prefixed with the level's symbol.
 */
export const formatMessage = (level: LogLevel, message: string): string =>
  `${SYMBOLS[level]} ${message}`;

/**
 * Write a formatted message to the stream appropriate for its level.
 * @param level - The severity level; `error` writes to stderr, others stdout.
 * @param message - The human-readable text to write.
 */
export const log = (level: LogLevel, message: string): void => {
  const stream = level === "error" ? process.stderr : process.stdout;
  stream.write(`${formatMessage(level, message)}\n`);
};

export const info = (message: string): void => log("info", message);
export const success = (message: string): void => log("success", message);
export const warn = (message: string): void => log("warn", message);
export const error = (message: string): void => log("error", message);
