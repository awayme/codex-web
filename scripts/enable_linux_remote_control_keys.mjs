#!/usr/bin/env node

import fs from "node:fs";
import path from "node:path";

const asarDirectory = path.resolve(process.argv[2] ?? "scratch/asar");
const buildDirectory = path.join(asarDirectory, ".vite", "build");
const mainBundles = fs
  .readdirSync(buildDirectory)
  .filter((name) => /^main-.*\.js$/u.test(name));

if (mainBundles.length !== 1) {
  throw new Error(
    `Expected exactly one desktop main bundle, found ${mainBundles.length}`,
  );
}

const bundlePath = path.join(buildDirectory, mainBundles[0]);
const source = fs.readFileSync(bundlePath, "utf8");
const original =
  "if(process.platform!==`darwin`&&process.platform!==`win32`)throw Error(`Remote control device keys are only available on macOS and Windows`)";
const replacement =
  "if(process.platform!==`darwin`&&process.platform!==`win32`&&process.env.CODEX_WEB_SOFTWARE_DEVICE_KEYS!==`1`)throw Error(`Remote control device keys are only available on macOS and Windows`)";
const occurrences = source.split(original).length - 1;

if (occurrences !== 1) {
  throw new Error(
    `Expected one macOS/Windows remote-control device-key guard, found ${occurrences}`,
  );
}

fs.writeFileSync(bundlePath, source.replace(original, replacement));
console.log(
  `Enabled guarded Linux remote-control device keys in ${bundlePath}`,
);
