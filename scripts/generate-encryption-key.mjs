#!/usr/bin/env node
/**
 * Generate a random 32-byte encryption key in hex format for ENCRYPTION_KEY.
 * Usage: node scripts/generate-encryption-key.mjs
 */

import { randomBytes } from "node:crypto";

const key = randomBytes(32).toString("hex");
console.log("\n✅ Encryption key generated:");
console.log(key);
console.log("\nAdd this to your .env file:");
console.log(`ENCRYPTION_KEY=${key}\n`);
