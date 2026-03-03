/**
 * Read-only stats from mcp_usage_events for the /usage dashboard.
 */

import type Database from "better-sqlite3";
import { createDatabase } from "../db/schema.js";

let db: Database.Database | null = null;

function getDb(): Database.Database | null {
  if (db) return db;
  try {
    db = createDatabase();
    return db;
  } catch (err) {
    console.error("[UsageStats] Failed to open database:", err);
    return null;
  }
}

export interface TopToolRow {
  tool_name: string;
  category: string | null;
  calls: number;
}

export interface VolumeByDayRow {
  day: string;
  total: number;
}

export interface RecentCallRow {
  id: number;
  ts: string;
  method: string | null;
  tool_name: string | null;
  category: string | null;
  status: string | null;
  duration_ms: number | null;
  meta: string | null;
}

export function getTopTools(limit = 20): TopToolRow[] {
  const database = getDb();
  if (!database) return [];
  try {
    const stmt = database.prepare(`
      SELECT tool_name, category, COUNT(*) AS calls
      FROM mcp_usage_events
      WHERE tool_name IS NOT NULL AND tool_name != ''
      GROUP BY tool_name, category
      ORDER BY calls DESC
      LIMIT ?
    `);
    return stmt.all(limit) as TopToolRow[];
  } catch (err) {
    console.error("[UsageStats] getTopTools error:", err);
    return [];
  }
}

export function getVolumeByDay(days = 30): VolumeByDayRow[] {
  const database = getDb();
  if (!database) return [];
  try {
    const modifier = `-${Math.abs(days)} days`;
    const stmt = database.prepare(`
      SELECT date(ts) AS day, COUNT(*) AS total
      FROM mcp_usage_events
      WHERE ts >= date('now', ?)
      GROUP BY day
      ORDER BY day ASC
    `);
    return stmt.all(modifier) as VolumeByDayRow[];
  } catch (err) {
    console.error("[UsageStats] getVolumeByDay error:", err);
    return [];
  }
}

export function getRecentCalls(limit = 50): RecentCallRow[] {
  const database = getDb();
  if (!database) return [];
  try {
    const stmt = database.prepare(`
      SELECT id, ts, method, tool_name, category, status, duration_ms,
             substr(meta_json, 1, 200) AS meta
      FROM mcp_usage_events
      ORDER BY id DESC
      LIMIT ?
    `);
    return stmt.all(limit) as RecentCallRow[];
  } catch (err) {
    console.error("[UsageStats] getRecentCalls error:", err);
    return [];
  }
}
