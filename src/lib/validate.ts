import { CliError } from "./errors.js";

/**
 * Validate that a string is a 12-digit AWS account id.
 * @param accountId - The candidate account id.
 * @returns True when the id is exactly 12 digits.
 */
export const isValidAccountId = (accountId: string): boolean =>
  /^\d{12}$/.test(accountId);

/**
 * Return the account id if valid, otherwise throw a user-facing error. Usable
 * as a definition so callers keep validation ahead of any side effects.
 * @param accountId - The candidate account id.
 * @returns The validated account id.
 * @throws {CliError} If the id is not a 12-digit number.
 */
export const requireAccountId = (accountId: string): string => {
  if (!isValidAccountId(accountId)) {
    throw new CliError(
      `Invalid account ID '${accountId}'. Must be a 12-digit number.`
    );
  }
  return accountId;
};

const EMAIL_PATTERN = /^[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}$/;

/**
 * Validate that a string looks like an email address.
 * @param email - The candidate email.
 * @returns True when the value matches a basic email pattern.
 */
export const isValidEmail = (email: string): boolean =>
  EMAIL_PATTERN.test(email);

/**
 * Return the email if valid, otherwise throw a user-facing error.
 * @param email - The candidate email.
 * @param label - A label naming which email (for the error message).
 * @returns The validated email.
 * @throws {CliError} If the email is malformed.
 */
export const requireEmail = (email: string, label: string): string => {
  if (!isValidEmail(email)) {
    throw new CliError(`Invalid ${label} email format: ${email}`);
  }
  return email;
};
