#!/usr/bin/env node

import fs from "node:fs";
import path from "node:path";

const asarDirectory = path.resolve(process.argv[2] ?? "scratch/asar");
const indexPath = path.join(asarDirectory, "webview", "index.html");
const source = fs.readFileSync(indexPath, "utf8");
const cspMetaPattern =
  /^[\t ]*<meta\s+http-equiv=["']Content-Security-Policy["'][^>]*>\r?\n?/gimu;
const occurrences = [...source.matchAll(cspMetaPattern)].length;

if (occurrences !== 1) {
  throw new Error(
    `Expected one upstream Content-Security-Policy meta tag, found ${occurrences}`,
  );
}

fs.writeFileSync(indexPath, source.replace(cspMetaPattern, ""));
