/**
 * Unit tests for ephemeral SQLite: isAllowedQuery (SQL injection / read-only), executeQuery, listLoadedTables, clearTables.
 * Run after build: npm run build && node --test tests/ephemeral-sqlite.test.mjs
 */

import { describe, it } from "node:test";
import assert from "node:assert";
import {
  getOrCreateDb,
  isAllowedQuery,
  executeQuery,
  listLoadedTables,
  clearTables,
} from "../dist/lib/ephemeral-sqlite.js";

describe("isAllowedQuery", () => {
  it("allows SELECT", () => {
    assert.strictEqual(isAllowedQuery("SELECT * FROM payables").allowed, true);
    assert.strictEqual(isAllowedQuery("  SELECT id, amount_eur FROM payables  ").allowed, true);
  });

  it("allows WITH (CTE)", () => {
    assert.strictEqual(isAllowedQuery("WITH t AS (SELECT 1) SELECT * FROM t").allowed, true);
    assert.strictEqual(isAllowedQuery("WITH t AS (SELECT 1) SELECT * FROM t").allowed, true);
  });

  it("rejects empty query", () => {
    const r = isAllowedQuery("");
    assert.strictEqual(r.allowed, false);
    assert.ok(r.message?.includes("Empty"));
  });

  it("rejects INSERT", () => {
    const r = isAllowedQuery("INSERT INTO payables (id) VALUES ('x')");
    assert.strictEqual(r.allowed, false);
    assert.ok(r.message);
  });

  it("rejects UPDATE", () => {
    const r = isAllowedQuery("UPDATE payables SET amount_eur = 0");
    assert.strictEqual(r.allowed, false);
  });

  it("rejects DELETE", () => {
    const r = isAllowedQuery("DELETE FROM payables");
    assert.strictEqual(r.allowed, false);
  });

  it("rejects DROP", () => {
    const r = isAllowedQuery("DROP TABLE payables");
    assert.strictEqual(r.allowed, false);
  });

  it("rejects CREATE", () => {
    const r = isAllowedQuery("CREATE TABLE x (id TEXT)");
    assert.strictEqual(r.allowed, false);
  });

  it("rejects query containing forbidden keyword even after SELECT", () => {
    const r = isAllowedQuery("SELECT * FROM payables WHERE description LIKE '%INSERT%'");
    assert.strictEqual(r.allowed, false);
  });
});

describe("executeQuery + listLoadedTables + clearTables", () => {
  const mockApi = {};

  it("getOrCreateDb returns a DB and persists by api identity", () => {
    const db = getOrCreateDb(mockApi);
    assert.ok(db);
    assert.strictEqual(getOrCreateDb(mockApi), db);
  });

  it("executeQuery rejects INSERT (SQL injection prevention)", () => {
    assert.throws(
      () => executeQuery(mockApi, "INSERT INTO payables (id) VALUES ('evil')"),
      /Only SELECT|allowed|INSERT/
    );
  });

  it("executeQuery runs SELECT after table is created via getOrCreateDb", () => {
    const db = getOrCreateDb(mockApi);
    db.exec("DROP TABLE IF EXISTS payables");
    db.exec(`
      CREATE TABLE payables (
        id TEXT PRIMARY KEY,
        supplier_name TEXT,
        amount_eur REAL
      )
    `);
    db.prepare("INSERT INTO payables (id, supplier_name, amount_eur) VALUES (?, ?, ?)").run("p1", "Acme", 100.5);
    db.prepare("INSERT INTO payables (id, supplier_name, amount_eur) VALUES (?, ?, ?)").run("p2", "Beta", 50.25);

    const result = executeQuery(mockApi, "SELECT id, supplier_name, amount_eur FROM payables ORDER BY id");
    assert.strictEqual(result.rowCount, 2);
    assert.strictEqual(result.truncated, false);
    assert.deepStrictEqual(result.rows[0], { id: "p1", supplier_name: "Acme", amount_eur: 100.5 });
    assert.deepStrictEqual(result.rows[1], { id: "p2", supplier_name: "Beta", amount_eur: 50.25 });
  });

  it("listLoadedTables returns table schema and row count", () => {
    const tables = listLoadedTables(mockApi);
    const payables = tables.find((t) => t.name === "payables");
    assert.ok(payables);
    assert.strictEqual(payables.rowCount, 2);
    assert.ok(payables.columns.some((c) => c.name === "id" && c.type));
  });

  it("clearTables drops specified table", () => {
    const r = clearTables(mockApi, ["payables"]);
    assert.deepStrictEqual(r.dropped, ["payables"]);
    const tables = listLoadedTables(mockApi);
    assert.strictEqual(tables.find((t) => t.name === "payables"), undefined);
  });

  it("clearTables with no args drops all tables", () => {
    const db = getOrCreateDb(mockApi);
    db.exec("CREATE TABLE t1 (id TEXT)");
    db.exec("CREATE TABLE t2 (id TEXT)");
    const r = clearTables(mockApi, []);
    assert.ok(r.dropped.length >= 2);
    assert.ok(r.dropped.includes("t1"));
    assert.ok(r.dropped.includes("t2"));
  });
});

describe("executeQuery MAX_ROWS cap", () => {
  const mockApi2 = {}; // fresh so we get a new DB

  it("returns at most 1000 rows and sets truncated", () => {
    const db = getOrCreateDb(mockApi2);
    db.exec("DROP TABLE IF EXISTS many");
    db.exec("CREATE TABLE many (id INTEGER PRIMARY KEY)");
    const ins = db.prepare("INSERT INTO many (id) VALUES (?)");
    const runMany = db.transaction(() => {
      for (let i = 1; i <= 1500; i++) ins.run(i);
    });
    runMany();
    const result = executeQuery(mockApi2, "SELECT id FROM many ORDER BY id");
    assert.strictEqual(result.rowCount, 1000);
    assert.strictEqual(result.truncated, true);
  });
});
