/** A delay function (ms → Promise); injectable so tests can run instantly. */
export type DelayFn = (ms: number) => Promise<void>;

/**
 * Real wall-clock delay backed by `setTimeout`.
 * @param ms - Milliseconds to wait.
 * @returns A promise that resolves after the delay.
 */
export const realDelay: DelayFn = ms =>
  new Promise(resolve => {
    setTimeout(resolve, ms);
  });

/**
 * Run an operation, retrying while it fails with a retryable error. Waits the
 * next entry of `backoffMs` before each retry, so the number of retries equals
 * the schedule's length; the final error is rethrown once it is exhausted.
 * @param op - The operation to run.
 * @param isRetryable - Predicate deciding whether a failure is worth retrying.
 * @param backoffMs - Delays (ms) to wait before each successive retry.
 * @param delay - Delay implementation (injectable for tests).
 * @returns The operation's result.
 */
export const retryWithBackoff = async <T>(
  op: () => Promise<T>,
  isRetryable: (caught: unknown) => boolean,
  backoffMs: readonly number[],
  delay: DelayFn = realDelay
): Promise<T> => {
  try {
    return await op();
  } catch (caught) {
    const [wait, ...rest] = backoffMs;
    if (wait === undefined || !isRetryable(caught)) {
      throw caught;
    }
    await delay(wait);
    return retryWithBackoff(op, isRetryable, rest, delay);
  }
};
