import assert from "node:assert/strict";
import net from "node:net";
import os from "node:os";
import { spawn } from "node:child_process";
import test from "node:test";

function listen(server, port, host) {
  return new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(port, host, () => {
      server.off("error", reject);
      resolve();
    });
  });
}

function close(server) {
  return new Promise((resolve, reject) => {
    server.close((error) => {
      if (error) {
        reject(error);
        return;
      }
      resolve();
    });
  });
}

function externalIpv4Address() {
  for (const addresses of Object.values(os.networkInterfaces())) {
    for (const address of addresses ?? []) {
      if (address.family === "IPv4" && !address.internal) {
        return address.address;
      }
    }
  }
  throw new Error("No external IPv4 address is available for the test");
}

test("forwards an external callback address to container loopback", async () => {
  const callbackServer = net.createServer((socket) => {
    socket.end("callback-ok");
  });
  await listen(callbackServer, 0, "127.0.0.1");

  const address = callbackServer.address();
  assert(address && typeof address === "object");
  const bridgeHost = externalIpv4Address();

  const bridge = spawn(
    process.execPath,
    ["docker/oauth-callback-bridge.mjs"],
    {
      cwd: new URL("..", import.meta.url),
      env: {
        ...process.env,
        CODEX_WEB_OAUTH_BRIDGE_HOST: bridgeHost,
        CODEX_WEB_OAUTH_CALLBACK_PORT: String(address.port),
      },
      stdio: ["ignore", "pipe", "pipe"],
    },
  );

  try {
    await new Promise((resolve, reject) => {
      const timeout = setTimeout(
        () => reject(new Error("OAuth callback bridge did not start")),
        5_000,
      );
      bridge.once("exit", (code) => {
        clearTimeout(timeout);
        reject(new Error(`OAuth callback bridge exited with code ${code}`));
      });
      bridge.stdout.once("data", () => {
        clearTimeout(timeout);
        resolve();
      });
    });

    const response = await new Promise((resolve, reject) => {
      const socket = net.createConnection({
        host: bridgeHost,
        port: address.port,
      });
      let body = "";
      socket.setEncoding("utf8");
      socket.on("data", (chunk) => {
        body += chunk;
      });
      socket.on("end", () => resolve(body));
      socket.on("error", reject);
    });

    assert.equal(response, "callback-ok");
  } finally {
    bridge.kill("SIGTERM");
    await close(callbackServer);
  }
});
