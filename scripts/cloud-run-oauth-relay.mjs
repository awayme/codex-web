#!/usr/bin/env node

import http from "node:http";
import { randomUUID } from "node:crypto";

const callbackPath = "/auth/callback";
const completionPath = "/__backend/oauth/remote-control-complete";

function usage() {
  console.error(
    "Usage: node scripts/cloud-run-oauth-relay.mjs https://YOUR-CLOUD-RUN-SERVICE",
  );
}

function parseTarget(rawTarget) {
  if (!rawTarget) {
    usage();
    process.exit(2);
  }

  const target = new URL(rawTarget);
  if (!new Set(["http:", "https:"]).has(target.protocol)) {
    throw new Error("The Codex Web URL must use http or https");
  }
  target.pathname = completionPath;
  target.search = "";
  target.hash = "";
  return target;
}

function parsePorts(rawPorts) {
  return (rawPorts ?? "1455,1457").split(",").map((rawPort) => {
    const port = Number(rawPort.trim());
    if (!Number.isInteger(port) || port <= 0 || port > 65535) {
      throw new Error(`Invalid OAuth relay port: ${rawPort}`);
    }
    return port;
  });
}

const target = parseTarget(process.argv[2]);
const ports = parsePorts(process.env.CODEX_WEB_OAUTH_RELAY_PORTS);
const servers = new Set();
let listeningCount = 0;
let settledCount = 0;

for (const port of ports) {
  const server = http.createServer((request, response) => {
    const requestUrl = new URL(request.url ?? "/", `http://127.0.0.1:${port}`);
    if (request.method !== "GET" || requestUrl.pathname !== callbackPath) {
      response.writeHead(404, {
        "Content-Type": "text/plain; charset=utf-8",
        Connection: "close",
      });
      response.end("Not Found");
      return;
    }

    const fragment = new URLSearchParams({
      requestId: randomUUID(),
      port: String(port),
      path: callbackPath,
      search: requestUrl.search,
    });
    const redirect = new URL(target);
    redirect.hash = fragment.toString();

    response.writeHead(302, {
      Location: redirect.toString(),
      "Cache-Control": "no-store",
      Connection: "close",
    });
    response.end();
  });

  servers.add(server);
  server.once("error", (error) => {
    settledCount += 1;
    if (error && error.code === "EADDRINUSE") {
      console.warn(`[cloud-run-oauth-relay] port ${port} is already in use`);
    } else {
      console.error(`[cloud-run-oauth-relay] port ${port} failed`, error);
    }
    if (settledCount === ports.length && listeningCount === 0) {
      process.exitCode = 1;
    }
  });
  server.listen(port, "127.0.0.1", () => {
    settledCount += 1;
    listeningCount += 1;
    console.log(
      `[cloud-run-oauth-relay] listening on http://localhost:${port}${callbackPath}`,
    );
    console.log(`[cloud-run-oauth-relay] callbacks return to ${target.origin}`);
  });
}

function close() {
  for (const server of servers) {
    server.close();
  }
}

process.once("SIGINT", close);
process.once("SIGTERM", close);
