/**
 * Unit tests for fetch-all-payables: safeEndDate, splitDateRange.
 * Run after build: npm run build && node --test tests/fetch-all-payables.test.mjs
 * 409 retry is covered by createSnapshotWithRetry in fetchAllPayables (integration).
 */

import { describe, it } from "node:test";
import assert from "node:assert";
import { safeEndDate, splitDateRange } from "../dist/lib/fetch-all-payables.js";

const today = new Date().toISOString().split("T")[0];

describe("safeEndDate", () => {
  it("returns today when to is in the future", () => {
    assert.strictEqual(safeEndDate("2099-12-31"), today);
    assert.strictEqual(safeEndDate("2030-01-01"), today);
  });

  it("returns to when to is today or in the past", () => {
    assert.strictEqual(safeEndDate(today), today);
    assert.strictEqual(safeEndDate("2020-01-01"), "2020-01-01");
    assert.strictEqual(safeEndDate("2020-06-15"), "2020-06-15");
  });
});

describe("splitDateRange", () => {
  const CHUNK_DAYS = 31;

  it("returns one chunk when range <= 31 days", () => {
    const chunks = splitDateRange("2026-01-01", "2026-01-31", CHUNK_DAYS);
    assert.strictEqual(chunks.length, 1);
    assert.deepStrictEqual(chunks[0], { from: "2026-01-01", to: "2026-01-31" });
  });

  it("splits 60 days into 2 chunks of at most 31 days", () => {
    const chunks = splitDateRange("2026-01-01", "2026-03-01", CHUNK_DAYS);
    assert.strictEqual(chunks.length, 2);
    assert.strictEqual(chunks[0].from, "2026-01-01");
    assert.strictEqual(chunks[0].to, "2026-01-31");
    assert.strictEqual(chunks[1].from, "2026-02-01");
    assert.strictEqual(chunks[1].to, "2026-03-01");
  });

  it("splits a full quarter (~90 days) into multiple chunks", () => {
    const chunks = splitDateRange("2026-01-01", "2026-03-31", CHUNK_DAYS);
    assert.ok(chunks.length >= 3);
    for (const { from, to } of chunks) {
      const fromD = new Date(from);
      const toD = new Date(to);
      const days = Math.ceil((toD - fromD) / (24 * 60 * 60 * 1000)) + 1;
      assert.ok(days <= CHUNK_DAYS, `chunk ${from}–${to} has ${days} days`);
    }
    assert.strictEqual(chunks[0].from, "2026-01-01");
    assert.strictEqual(chunks[chunks.length - 1].to, "2026-03-31");
  });
});
