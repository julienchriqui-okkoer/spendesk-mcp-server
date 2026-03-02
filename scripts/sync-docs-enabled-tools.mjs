#!/usr/bin/env node
/**
 * Sync Mintlify docs with config/tools.config.json disabledTools.
 * - overview.mdx (en + fr): remove table rows for disabled tools, update counts
 * - bookkeeping.mdx, accounts-payable.mdx, reference-data.mdx: remove ## sections for disabled tools
 * - spend-analysis.mdx: if spendesk_analyze_spend disabled, replace with placeholder
 * Run from project root. Run before mintlify build (e.g. npm run docs:sync-tools).
 */

import { readFileSync, writeFileSync, existsSync } from "fs";
import { join, dirname } from "path";
import { fileURLToPath } from "url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const CONFIG_PATH = join(ROOT, "config", "tools.config.json");
const DOCS_DIR = join(ROOT, "spendesk-mcp-docs");

function loadDisabledTools() {
  if (!existsSync(CONFIG_PATH)) return [];
  const raw = readFileSync(CONFIG_PATH, "utf-8");
  const config = JSON.parse(raw);
  return Array.isArray(config.disabledTools) ? config.disabledTools : [];
}

function extractToolNameFromTableRow(line) {
  const m = line.match(/`(spendesk_[a-z0-9_]+)`/);
  return m ? m[1] : null;
}

function filterOverviewTables(content, disabledSet, isFr) {
  const compositeLabel = isFr ? "## Outils composites (" : "## Composite tools (";
  const coreLabel = isFr ? "## Outils API de base (" : "## Core API tools (";

  const lines = content.split("\n");
  const out = [];
  let inComposite = false;
  let inCore = false;
  let compositeRows = 0;
  let coreRows = 0;
  let compositeHeaderLineIndex = -1;
  let coreHeaderLineIndex = -1;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];

    if (line.startsWith(compositeLabel)) {
      inComposite = true;
      inCore = false;
      compositeHeaderLineIndex = out.length;
      out.push(line);
      continue;
    }
    if (line.startsWith(coreLabel)) {
      inCore = true;
      inComposite = false;
      coreHeaderLineIndex = out.length;
      out.push(line);
      continue;
    }

    const toolName = extractToolNameFromTableRow(line);
    if (toolName && disabledSet.has(toolName)) {
      continue;
    }
    if (toolName && line.trim().startsWith("|") && !line.trim().startsWith("|---")) {
      if (inComposite) compositeRows++;
      else if (inCore) coreRows++;
    }

    out.push(line);
  }

  if (compositeHeaderLineIndex >= 0) {
    const oldLine = out[compositeHeaderLineIndex];
    out[compositeHeaderLineIndex] = oldLine.replace(/\(\d+\)/, `(${compositeRows})`);
  }
  if (coreHeaderLineIndex >= 0) {
    const oldLine = out[coreHeaderLineIndex];
    out[coreHeaderLineIndex] = oldLine.replace(/\(\d+\)/, `(${coreRows})`);
  }

  return out.join("\n");
}

function removeSectionsForDisabledTools(content, disabledSet) {
  const lines = content.split("\n");
  const out = [];
  let skipUntilNextH2 = false;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (line.startsWith("## spendesk_")) {
      const toolName = line.slice(2).trim();
      if (disabledSet.has(toolName)) {
        skipUntilNextH2 = true;
        continue;
      }
      skipUntilNextH2 = false;
    } else if (skipUntilNextH2 && line.startsWith("## ")) {
      skipUntilNextH2 = false;
    }

    if (!skipUntilNextH2) {
      out.push(line);
    }
  }

  return out.join("\n");
}

function processOverview(path, disabledSet, isFr) {
  const content = readFileSync(path, "utf-8");
  const next = filterOverviewTables(content, disabledSet, isFr);
  writeFileSync(path, next);
  console.log("Updated:", path);
}

function processSectionPage(path, disabledSet) {
  const content = readFileSync(path, "utf-8");
  const next = removeSectionsForDisabledTools(content, disabledSet);
  writeFileSync(path, next);
  console.log("Updated:", path);
}

function main() {
  const disabledTools = loadDisabledTools();
  const disabledSet = new Set(disabledTools);
  console.log("Disabled tools:", disabledTools.length, disabledTools.slice(0, 5).join(", ") + (disabledTools.length > 5 ? "..." : ""));

  processOverview(join(DOCS_DIR, "tools", "overview.mdx"), disabledSet, false);
  processOverview(join(DOCS_DIR, "fr", "tools", "overview.mdx"), disabledSet, true);

  processSectionPage(join(DOCS_DIR, "tools", "bookkeeping.mdx"), disabledSet);
  processSectionPage(join(DOCS_DIR, "tools", "accounts-payable.mdx"), disabledSet);
  processSectionPage(join(DOCS_DIR, "tools", "reference-data.mdx"), disabledSet);

  console.log("Docs sync done.");
}

main();
