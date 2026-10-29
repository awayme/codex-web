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

function parsePorts(rawPorts) {
  const ports = rawPorts.split(",").map((rawPort) => parsePort(rawPort.trim()));
  if (ports.length === 0 || new Set(ports).size !== ports.length) {
    throw new Error("OAuth callback ports must be a non-empty unique list");
  }
  return ports;
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

const callbackPorts = parsePorts(
  process.env.CODEX_WEB_OAUTH_CALLBACK_PORTS ??
    process.env.CODEX_WEB_OAUTH_CALLBACK_PORT ??
    "1455,1457",
);
const bridgeHost =
  process.env.CODEX_WEB_OAUTH_BRIDGE_HOST ?? findExternalIpv4Address();
const loopbackHosts = ["::1", "127.0.0.1"];

function connectToLoopback(client, callbackPort) {
  let callback;

  const tryHost = (index) => {
    const host = loopbackHosts[index];
    callback = net.createConnection({
      host,
      port: callbackPort,
    });

    const handleConnectionError = () => {
      callback.destroy();
      if (!client.destroyed && index + 1 < loopbackHosts.length) {
        tryHost(index + 1);
        return;
      }
      client.destroy();
    };

    callback.once("error", handleConnectionError);
    callback.once("connect", () => {
      callback.off("error", handleConnectionError);
      callback.on("error", () => {
        client.destroy();
      });
      client.pipe(callback);
      callback.pipe(client);
    });
  };

  client.on("error", () => {
    callback?.destroy();
  });
  tryHost(0);
}

for (const callbackPort of callbackPorts) {
  const server = net.createServer((client) => {
    connectToLoopback(client, callbackPort);
  });

  server.on("error", (error) => {
    console.error(`[oauth-callback-bridge] port ${callbackPort} failed`, error);
    process.exitCode = 1;
  });

  server.listen(callbackPort, bridgeHost, () => {
    console.log(
      `[oauth-callback-bridge] forwarding ${bridgeHost}:${callbackPort} to loopback:${callbackPort}`,
    );
  });
}
