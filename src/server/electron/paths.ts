import os from "node:os";
import path from "node:path";

export type ElectronPathOptions = {
  dataDir?: string;
  homeDir?: string;
  tempDir?: string;
};

export function getCodexWebDataDir(options: ElectronPathOptions = {}): string {
  const configuredDataDir =
    options.dataDir ?? process.env.CODEX_WEB_DATA_DIR?.trim();
  if (configuredDataDir) {
    return path.resolve(configuredDataDir);
  }

  const homeDir = options.homeDir ?? os.homedir();
  return path.join(homeDir, ".local", "share", "codex-web");
}

export function getElectronPath(
  name: string,
  options: ElectronPathOptions = {},
): string {
  const homeDir = options.homeDir ?? os.homedir();
  const dataDir = getCodexWebDataDir({ ...options, homeDir });
  const tempDir = options.tempDir ?? os.tmpdir();

  const paths: Record<string, string> = {
    appData: path.dirname(dataDir),
    cache: path.join(dataDir, "cache"),
    crashDumps: path.join(dataDir, "crash-dumps"),
    desktop: path.join(homeDir, "Desktop"),
    documents: path.join(homeDir, "Documents"),
    downloads: path.join(homeDir, "Downloads"),
    home: homeDir,
    logs: path.join(dataDir, "logs"),
    music: path.join(homeDir, "Music"),
    pictures: path.join(homeDir, "Pictures"),
    recent: path.join(dataDir, "recent"),
    sessionData: path.join(dataDir, "session"),
    temp: tempDir,
    userData: dataDir,
    videos: path.join(homeDir, "Videos"),
  };

  return paths[name] ?? dataDir;
}
