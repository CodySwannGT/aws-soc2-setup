import { describe, expect, it } from "vitest";

import { collectPaged, type Page } from "../../src/lib/paginate.js";

describe("collectPaged", () => {
  it("returns a single page when there is no next token", async () => {
    const items = await collectPaged<number>(async () => ({
      items: [1, 2],
      next: undefined,
    }));
    expect(items).toEqual([1, 2]);
  });

  it("follows next tokens across multiple pages", async () => {
    const pages: Record<string, Page<number>> = {
      "": { items: [1, 2], next: "t1" },
      t1: { items: [3, 4], next: "t2" },
      t2: { items: [5], next: undefined },
    };
    const items = await collectPaged<number>(
      async token => pages[token ?? ""]!
    );
    expect(items).toEqual([1, 2, 3, 4, 5]);
  });
});
