/** One page of an AWS list response: its items and the next-page token. */
export interface Page<T> {
  items: T[];
  next: string | undefined;
}

/**
 * Collect every item across a paginated AWS list operation by following next
 * tokens. Recursive (no mutable accumulator) to satisfy the functional lint
 * rules. The bash scripts relied on the AWS CLI's implicit auto-pagination;
 * this restores that behavior for the SDK.
 * @param fetch - Fetches one page given the previous page's token (undefined on the first call).
 * @param token - Internal: the token for the next page.
 * @returns Every item across all pages.
 */
export const collectPaged = async <T>(
  fetch: (token: string | undefined) => Promise<Page<T>>,
  token?: string
): Promise<T[]> => {
  const page = await fetch(token);
  if (!page.next) {
    return page.items;
  }
  return [...page.items, ...(await collectPaged(fetch, page.next))];
};
