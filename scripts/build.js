#!/usr/bin/env node
// Produces a Chrome Web Store upload package in dist/.
//
// Only the files listed in SHIP_FILES are copied, so development artefacts
// (.DS_Store, tests, planning notes, this script) can never end up in the zip.

import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const DIST = path.join(ROOT, "dist");

const SHIP_FILES = [
  "manifest.json",
  "background.js",
  "content.js",
  "offscreen.html",
  "offscreen.js",
  "popup.html",
  "popup.css",
  "popup.js",
  "results.html",
  "results.css",
  "results.js",
  "lib/normalize.js",
  "lib/matcher.js",
  "lib/hits.js",
  "lib/storage.js",
  "lib/export.js",
  "lib/highlighter.js",
  "lib/floatingWidget.js",
  "icons/icon16.png",
  "icons/icon48.png",
  "icons/icon128.png",
];

function fail(message) {
  console.error(`✗ ${message}`);
  process.exit(1);
}

function validate(manifest) {
  const problems = [];

  for (const file of SHIP_FILES) {
    if (!fs.existsSync(path.join(ROOT, file))) problems.push(`missing file: ${file}`);
  }

  if (manifest.manifest_version !== 3) problems.push("manifest_version must be 3");
  if (!/^\d+(\.\d+){0,3}$/.test(manifest.version || "")) problems.push(`invalid version: ${manifest.version}`);

  // Every local script/style/page the shipped HTML references must ship too.
  const shipped = new Set(SHIP_FILES);
  for (const page of SHIP_FILES.filter((f) => f.endsWith(".html"))) {
    const html = fs.readFileSync(path.join(ROOT, page), "utf8");
    for (const [, ref] of html.matchAll(/(?:src|href)="([^"]+)"/g)) {
      if (/^(https?:|data:|#|mailto:)/.test(ref)) continue;
      const resolved = path.posix.normalize(path.posix.join(path.posix.dirname(page), ref));
      if (!shipped.has(resolved)) problems.push(`${page} references ${ref}, which is not shipped`);
    }
  }

  // Local ES module imports from shipped JS must ship too.
  for (const file of SHIP_FILES.filter((f) => f.endsWith(".js"))) {
    const js = fs.readFileSync(path.join(ROOT, file), "utf8");
    for (const [, spec] of js.matchAll(/(?:^|\n)\s*import[^"']*["'](\.[^"']+)["']/g)) {
      const resolved = path.posix.normalize(path.posix.join(path.posix.dirname(file), spec));
      if (!shipped.has(resolved)) problems.push(`${file} imports ${spec}, which is not shipped`);
    }
  }

  if (problems.length) {
    problems.forEach((p) => console.error(`  - ${p}`));
    fail(`${problems.length} packaging problem(s) found.`);
  }
}

const manifest = JSON.parse(fs.readFileSync(path.join(ROOT, "manifest.json"), "utf8"));
validate(manifest);

const stageName = "sitefind-extension";
const stage = path.join(DIST, stageName);
fs.rmSync(DIST, { recursive: true, force: true });

for (const file of SHIP_FILES) {
  const dest = path.join(stage, file);
  fs.mkdirSync(path.dirname(dest), { recursive: true });
  fs.copyFileSync(path.join(ROOT, file), dest);
}

const zipName = `sitefind-${manifest.version}.zip`;
// Zipped from inside the staged folder: the Chrome Web Store requires
// manifest.json at the root of the archive, not inside a wrapper directory.
// -X drops macOS resource forks; the staged tree has no dotfiles to exclude.
execFileSync("zip", ["-r", "-X", "-q", path.join(DIST, zipName), "."], { cwd: stage });

const bytes = fs.statSync(path.join(DIST, zipName)).size;
console.log(`✓ ${SHIP_FILES.length} files staged in dist/${stageName}`);
console.log(`✓ dist/${zipName} (${(bytes / 1024).toFixed(1)} KB) ready to upload`);
