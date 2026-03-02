/**
 * Tools configuration: which MCP tools are enabled/disabled.
 * Disabled tools are not registered and are excluded from the API reference.
 * Use config/tools.config.json to disable experimental tools.
 */

import { readFileSync, existsSync } from "fs";
import { join } from "path";

const CONFIG_FILENAMES = [
  join(process.cwd(), "config", "tools.config.json"),
  join(process.cwd(), "tools.config.json"),
];

export type ToolsConfig = {
  /** Tool names to not register and not show in API reference (e.g. experimental). */
  disabledTools?: string[];
};

let cached: ToolsConfig | null = null;

function loadConfig(): ToolsConfig {
  if (cached) return cached;
  for (const file of CONFIG_FILENAMES) {
    if (existsSync(file)) {
      try {
        const raw = readFileSync(file, "utf-8");
        cached = JSON.parse(raw) as ToolsConfig;
        break;
      } catch {
        cached = {};
      }
    }
  }
  if (!cached) cached = {};
  return cached;
}

/** True if the tool should be registered and shown in the API reference. */
export function isToolEnabled(toolName: string): boolean {
  const list = loadConfig().disabledTools;
  if (!Array.isArray(list)) return true;
  return !list.includes(toolName);
}

/** List of disabled tool names (for debugging or docs). */
export function getDisabledTools(): string[] {
  const list = loadConfig().disabledTools;
  return Array.isArray(list) ? [...list] : [];
}
