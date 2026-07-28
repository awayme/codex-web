#!/usr/bin/env node

import { spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import fs from "node:fs/promises";
import { createRequire } from "node:module";
import os from "node:os";
import path from "node:path";
import process from "node:process";

const appRequire = createRequire(
  path.join(process.env.CODEX_WEB_APP_DIR || process.cwd(), "package.json"),
);
const Database = appRequire("better-sqlite3");

const SQLITE_HEADER = Buffer.from("SQLite format 3\0");
const SNAPSHOT_INTERVAL_MS = 15_000;
const MAX_SNAPSHOTS = 4;
const EXCLUDED_DIRECTORY_NAMES = new Set([
  ".remote-plugin-install-staging",
  "Cache",
  "Code Cache",
  "DawnCache",
  "GPUCache",
  "blob_storage",
  "cache",
  "crash-dumps",
  "logs",
  "session",
  "sentry",
  "tmp",
]);
const EXCLUDED_FILE_SUFFIXES = ["-journal", "-shm", "-wal", ".sock"];

function isExcludedFile(relativePath, sourceName) {
  if (EXCLUDED_FILE_SUFFIXES.some((suffix) => sourceName.endsWith(suffix))) {
    return true;
  }
  return relativePath === "codex/auth.json";
}

async function isSqliteDatabase(filePath) {
  const file = await fs.open(filePath, "r");
  try {
    const header = Buffer.alloc(SQLITE_HEADER.length);
    const { bytesRead } = await file.read(header, 0, SQLITE_HEADER.length, 0);
    return bytesRead === SQLITE_HEADER.length && header.equals(SQLITE_HEADER);
  } finally {
    await file.close();
  }
}

async function copySnapshotTree(sourceRoot, destinationRoot, prefix) {
  let entries;
  try {
    entries = await fs.readdir(sourceRoot, { withFileTypes: true });
  } catch (error) {
    if (error?.code === "ENOENT") {
      return;
    }
    throw error;
  }

  await fs.mkdir(destinationRoot, { recursive: true });
  for (const entry of entries) {
    if (entry.isDirectory() && EXCLUDED_DIRECTORY_NAMES.has(entry.name)) {
      continue;
    }

    const sourcePath = path.join(sourceRoot, entry.name);
    const destinationPath = path.join(destinationRoot, entry.name);
    const relativePath = path.posix.join(prefix, entry.name);
    if (entry.isDirectory()) {
      await copySnapshotTree(sourcePath, destinationPath, relativePath);
      continue;
    }
    if (!entry.isFile() || isExcludedFile(relativePath, entry.name)) {
      continue;
    }

    await fs.mkdir(path.dirname(destinationPath), { recursive: true });
    if (await isSqliteDatabase(sourcePath)) {
      const database = new Database(sourcePath, {
        fileMustExist: true,
        readonly: true,
      });
      try {
        await database.backup(destinationPath);
      } finally {
        database.close();
      }
    } else {
      await fs.copyFile(sourcePath, destinationPath);
    }
  }
}

async function copyRestoreTree(sourceRoot, destinationRoot) {
  let entries;
  try {
    entries = await fs.readdir(sourceRoot, { withFileTypes: true });
  } catch (error) {
    if (error?.code === "ENOENT") {
      return;
    }
    throw error;
  }

  await fs.mkdir(destinationRoot, { recursive: true });
  for (const entry of entries) {
    const sourcePath = path.join(sourceRoot, entry.name);
    const destinationPath = path.join(destinationRoot, entry.name);
    if (entry.isDirectory()) {
      await copyRestoreTree(sourcePath, destinationPath);
    } else if (entry.isFile()) {
      await fs.copyFile(sourcePath, destinationPath);
    }
  }
}

function run(command, args) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { stdio: ["ignore", "ignore", "pipe"] });
    let stderr = "";
    child.stderr.setEncoding("utf8");
    child.stderr.on("data", (chunk) => {
      stderr += chunk;
    });
    child.once("error", reject);
    child.once("exit", (code) => {
      if (code === 0) {
        resolve();
      } else {
        reject(
          new Error(
            `${command} exited with ${code}: ${stderr.trim() || "unknown error"}`,
          ),
        );
      }
    });
  });
}

async function validateArchive(archivePath) {
  const child = spawn("tar", ["-tf", archivePath], {
    stdio: ["ignore", "pipe", "pipe"],
  });
  let stdout = "";
  let stderr = "";
  child.stdout.setEncoding("utf8");
  child.stderr.setEncoding("utf8");
  child.stdout.on("data", (chunk) => {
    stdout += chunk;
  });
  child.stderr.on("data", (chunk) => {
    stderr += chunk;
  });
  const code = await new Promise((resolve, reject) => {
    child.once("error", reject);
    child.once("exit", resolve);
  });
  if (code !== 0) {
    throw new Error(`invalid state archive: ${stderr.trim()}`);
  }
  for (const entry of stdout.split("\n").filter(Boolean)) {
    if (
      path.posix.isAbsolute(entry) ||
      entry.split("/").some((component) => component === "..")
    ) {
      throw new Error(`unsafe path in state archive: ${entry}`);
    }
  }
}

function snapshotDirectoryFor(backupFile) {
  return `${backupFile}.snapshots`;
}

async function snapshotCandidates(backupFile) {
  const candidates = [];
  const snapshotDirectory = snapshotDirectoryFor(backupFile);
  try {
    for (const entry of await fs.readdir(snapshotDirectory, {
      withFileTypes: true,
    })) {
      if (!entry.isFile() || !entry.name.endsWith(".tar")) {
        continue;
      }
      const filePath = path.join(snapshotDirectory, entry.name);
      const stats = await fs.stat(filePath);
      candidates.push({ filePath, modifiedAt: stats.mtimeMs });
    }
  } catch (error) {
    if (error?.code !== "ENOENT") {
      throw error;
    }
  }

  try {
    const stats = await fs.stat(backupFile);
    candidates.push({ filePath: backupFile, modifiedAt: stats.mtimeMs });
  } catch (error) {
    if (error?.code !== "ENOENT") {
      throw error;
    }
  }

  return candidates.sort((left, right) => right.modifiedAt - left.modifiedAt);
}

export async function createStateSnapshot({
  backupFile,
  codexHome,
  electronDataDir,
}) {
  const workspace = await fs.mkdtemp(
    path.join(os.tmpdir(), "codex-web-state-"),
  );
  const stagingDirectory = path.join(workspace, "state");
  const localArchive = path.join(workspace, "codex-web-state.tar");
  try {
    await copySnapshotTree(
      electronDataDir,
      path.join(stagingDirectory, "electron"),
      "electron",
    );
    await copySnapshotTree(
      codexHome,
      path.join(stagingDirectory, "codex"),
      "codex",
    );
    await run("tar", ["-cf", localArchive, "-C", stagingDirectory, "."]);
    const snapshotDirectory = snapshotDirectoryFor(backupFile);
    await fs.mkdir(snapshotDirectory, { recursive: true });
    const snapshotFile = path.join(
      snapshotDirectory,
      `snapshot-${Date.now()}-${randomUUID()}.tar`,
    );
    await fs.copyFile(localArchive, snapshotFile);
    await fs.chmod(snapshotFile, 0o600).catch(() => undefined);

    const candidates = (await snapshotCandidates(backupFile)).filter(
      ({ filePath }) => filePath !== backupFile,
    );
    await Promise.all(
      candidates
        .slice(MAX_SNAPSHOTS)
        .map(({ filePath }) => fs.rm(filePath, { force: true })),
    );
  } finally {
    await fs.rm(workspace, { force: true, recursive: true });
  }
}

export async function restoreStateSnapshot({
  backupFile,
  codexHome,
  electronDataDir,
}) {
  const candidates = await snapshotCandidates(backupFile);
  if (candidates.length === 0) {
    return false;
  }

  const workspace = await fs.mkdtemp(
    path.join(os.tmpdir(), "codex-web-restore-"),
  );
  try {
    for (const [index, candidate] of candidates.entries()) {
      const localArchive = path.join(workspace, `candidate-${index}.tar`);
      const extractionDirectory = path.join(workspace, `candidate-${index}`);
      try {
        await fs.copyFile(candidate.filePath, localArchive);
        await validateArchive(localArchive);
        await fs.mkdir(extractionDirectory, { recursive: true });
        await run("tar", ["-xf", localArchive, "-C", extractionDirectory]);
        await copyRestoreTree(
          path.join(extractionDirectory, "electron"),
          electronDataDir,
        );
        await copyRestoreTree(
          path.join(extractionDirectory, "codex"),
          codexHome,
        );
        return true;
      } catch (error) {
        console.error(
          `[state-sync] skipped invalid snapshot ${candidate.filePath}`,
          error,
        );
      }
    }
    throw new Error("no valid state snapshot could be restored");
  } finally {
    await fs.rm(workspace, { force: true, recursive: true });
  }
}

function stateOptionsFromEnvironment() {
  const backupFile = process.env.CODEX_WEB_STATE_BACKUP_FILE?.trim();
  const codexHome = process.env.CODEX_HOME?.trim();
  const electronDataDir = process.env.CODEX_WEB_DATA_DIR?.trim();
  if (!backupFile || !codexHome || !electronDataDir) {
    throw new Error(
      "CODEX_WEB_STATE_BACKUP_FILE, CODEX_HOME, and CODEX_WEB_DATA_DIR are required",
    );
  }
  return {
    backupFile: path.resolve(backupFile),
    codexHome: path.resolve(codexHome),
    electronDataDir: path.resolve(electronDataDir),
  };
}

async function main() {
  const mode = process.argv[2];
  const options = stateOptionsFromEnvironment();
  if (mode === "restore") {
    const restored = await restoreStateSnapshot(options);
    console.log(
      restored
        ? `[state-sync] restored state from ${options.backupFile}`
        : `[state-sync] no saved state found at ${options.backupFile}`,
    );
    return;
  }
  if (mode === "snapshot") {
    await createStateSnapshot(options);
    console.log(`[state-sync] saved state to ${options.backupFile}`);
    return;
  }
  if (mode !== "watch") {
    throw new Error("usage: state-sync.mjs restore|snapshot|watch");
  }

  let snapshotPromise = Promise.resolve();
  const snapshot = () => {
    snapshotPromise = snapshotPromise
      .catch(() => undefined)
      .then(() => createStateSnapshot(options))
      .catch((error) => {
        console.error("[state-sync] snapshot failed", error);
      });
  };
  snapshot();
  const interval = setInterval(snapshot, SNAPSHOT_INTERVAL_MS);
  const stop = async () => {
    clearInterval(interval);
    snapshot();
    await snapshotPromise;
    process.exit(0);
  };
  process.once("SIGINT", stop);
  process.once("SIGTERM", stop);
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch((error) => {
    console.error("[state-sync] fatal error", error);
    process.exit(1);
  });
}
