#!/usr/bin/env node

import net from "node:net";
import os from "node:os";

function parsePort(rawPort) {
  const port = Number(rawPort);
  if (!Number.isInteger(port) || port <= 0 || port > 65535) {
    throw new Error(`Invalid OAuth callback port: ${rawPort}`);
  }
  return port;
}

function findExternalIpv4Address() {
  for (const addresses of Object.values(os.networkInterfaces())) {
    for (const address of addresses ?? []) {
      if (address.family === "IPv4" && !address.internal) {
        return address.address;
      }
    }
  }
  throw new Error("No external IPv4 address is available for the OAuth bridge");
}

const callbackPort = parsePort(
  process.env.CODEX_WEB_OAUTH_CALLBACK_PORT ?? "1455",
);
const bridgeHost =
  process.env.CODEX_WEB_OAUTH_BRIDGE_HOST ?? findExternalIpv4Address();

const server = net.createServer((client) => {
  const callback = net.createConnection({
    host: "127.0.0.1",
    port: callbackPort,
  });

  client.on("error", () => {
    callback.destroy();
  });
  callback.on("error", () => {
    client.destroy();
  });

  client.pipe(callback);
  callback.pipe(client);
});

server.on("error", (error) => {
  console.error("[oauth-callback-bridge] failed", error);
  process.exitCode = 1;
});

server.listen(callbackPort, bridgeHost, () => {
  console.log(
    `[oauth-callback-bridge] forwarding ${bridgeHost}:${callbackPort} to 127.0.0.1:${callbackPort}`,
  );
});
