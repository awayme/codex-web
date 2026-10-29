import Module from "node:module";
import path from "node:path";

export function installModuleAliasHook(): void {
  const moduleWithLoad = Module as typeof Module & {
    _load: (
      request: string,
      parent: NodeModule | undefined,
      isMain: boolean,
    ) => unknown;
  };
  const originalLoad = moduleWithLoad._load;

  moduleWithLoad._load = function moduleAliasLoad(
    request: string,
    parent: NodeModule | undefined,
    isMain: boolean,
  ): unknown {
    if (request === "electron") {
      return originalLoad.call(
        this,
        path.resolve(
          path.resolve(__dirname, "../.."),
          "src/server/electron/index.js",
        ),
        parent,
        isMain,
      );
    }

    if (
      process.env.CODEX_WEB_SOFTWARE_DEVICE_KEYS === "1" &&
      path.basename(request) === "remote-control-device-key.node"
    ) {
      return originalLoad.call(
        this,
        path.resolve(__dirname, "software-device-key.js"),
        parent,
        isMain,
      );
    }

    return originalLoad.call(this, request, parent, isMain);
  };
}
