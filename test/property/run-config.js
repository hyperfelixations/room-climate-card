"use strict";

// Shared execution configuration for deterministic property runs.
// Seeds are printed and may be supplied explicitly; report files are written only when CI
// or a developer opts into an output directory, keeping ordinary runs read-only apart from
// the bundle they already build.

const fs = require("node:fs");
const path = require("node:path");

function readCount(name, fallback) {
  const raw = process.env[name];
  if (raw === undefined || raw === "") return fallback;
  const value = Number(raw);
  if (!Number.isSafeInteger(value) || value <= 0) throw new Error(`${name} must be a positive safe integer, got ${raw}`);
  return value;
}

function readSeed(name, fallback) {
  const raw = process.env[name];
  if (raw === undefined || raw === "") return fallback >>> 0;
  const value = Number(raw);
  if (!Number.isSafeInteger(value) || value < 0) {
    throw new Error(`${name} must be a non-negative safe integer (decimal or 0x-prefixed), got ${raw}`);
  }
  // GitHub run ids are stable across a rerun but may exceed 32 bits. Folding them retains
  // that reproducibility while matching the generator's unsigned 32-bit state.
  return value >>> 0;
}

function formatSeed(seed) {
  return `0x${(seed >>> 0).toString(16).padStart(8, "0")}`;
}

function writePropertyReport(name, payload) {
  const directory = process.env.ROOM_CLIMATE_CARD_PROPERTY_REPORT_DIR;
  if (!directory) return null;
  fs.mkdirSync(directory, { recursive: true });
  const file = path.join(directory, `${name}.json`);
  fs.writeFileSync(file, `${JSON.stringify(payload, null, 2)}\n`, "utf8");
  return file;
}

module.exports = { readCount, readSeed, formatSeed, writePropertyReport };
