import assert from "node:assert/strict";
import http from "node:http";
import { spawn } from "node:child_process";
import test from "node:test";
import {
  forwardRemoteControlOAuthCallback,
  parseRemoteControlOAuthCallback,
  remoteControlOAuthCompleteHtml,
} from "../src/server/oauth-callback.js";

function listen(server, port = 0) {
  return new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(port, "127.0.0.1", () => {
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

test("validates remote-control callback payloads", () => {
  assert.deepEqual(
    parseRemoteControlOAuthCallback({
      port: 1455,
      path: "/auth/callback",
      search: "?code=authorization-code&state=expected-state",
    }),
    {
      port: 1455,
      path: "/auth/callback",
      search: "?code=authorization-code&state=expected-state",
    },
  );

  assert.throws(
    () =>
      parseRemoteControlOAuthCallback({
        port: 8080,
        path: "/auth/callback",
        search: "?code=authorization-code&state=expected-state",
      }),
    /Unsupported remote-control OAuth callback port/,
  );
  assert.throws(
    () =>
      parseRemoteControlOAuthCallback({
        port: 1455,
        path: "/not-the-callback",
        search: "?code=authorization-code&state=expected-state",
      }),
    /Unsupported remote-control OAuth callback path/,
  );
  assert.throws(
    () =>
      parseRemoteControlOAuthCallback({
        port: 1455,
        path: "/auth/callback",
        search: "?code=authorization-code",
      }),
    /missing state/,
  );
});

test("forwards a callback to the loopback OAuth listener", async () => {
  let receivedUrl = null;
  const callbackServer = http.createServer((request, response) => {
    receivedUrl = request.url;
    response.writeHead(200, { "Content-Type": "text/plain" });
    response.end("ok");
  });
  await listen(callbackServer);

  try {
    const address = callbackServer.address();
    assert(address && typeof address === "object");
    await forwardRemoteControlOAuthCallback({
      port: address.port,
      path: "/auth/callback",
      search: "?code=authorization-code&state=expected-state",
    });
    assert.equal(
      receivedUrl,
      "/auth/callback?code=authorization-code&state=expected-state",
    );
  } finally {
    await close(callbackServer);
  }
});

test("completion page keeps OAuth values in the browser fragment", () => {
  const html = remoteControlOAuthCompleteHtml();
  assert.match(html, /location\.hash/);
  assert.match(html, /BroadcastChannel/);
  assert.doesNotMatch(html, /authorization-code/);
});

test("local relay redirects the localhost callback into a fragment", async () => {
  const reservation = http.createServer();
  await listen(reservation);
  const address = reservation.address();
  assert(address && typeof address === "object");
  const relayPort = address.port;
  await close(reservation);

  const relay = spawn(
    process.execPath,
    ["scripts/cloud-run-oauth-relay.mjs", "https://codex-web.example.test/"],
    {
      cwd: new URL("..", import.meta.url),
      env: {
        ...process.env,
        CODEX_WEB_OAUTH_RELAY_PORTS: String(relayPort),
      },
      stdio: ["ignore", "pipe", "pipe"],
    },
  );

  try {
    await new Promise((resolve, reject) => {
      const timeout = setTimeout(
        () => reject(new Error("OAuth relay did not start")),
        5_000,
      );
      relay.once("exit", (code) => {
        clearTimeout(timeout);
        reject(new Error(`OAuth relay exited with code ${code}`));
      });
      relay.stdout.once("data", () => {
        clearTimeout(timeout);
        resolve();
      });
    });

    const location = await new Promise((resolve, reject) => {
      const request = http.get(
        `http://127.0.0.1:${relayPort}/auth/callback?code=secret-code&state=expected-state`,
        (response) => {
          response.resume();
          response.once("end", () => resolve(response.headers.location));
        },
      );
      request.once("error", reject);
    });

    assert.equal(typeof location, "string");
    const redirect = new URL(location);
    assert.equal(
      redirect.origin + redirect.pathname,
      "https://codex-web.example.test/__backend/oauth/remote-control-complete",
    );
    assert.equal(redirect.search, "");
    const fragment = new URLSearchParams(redirect.hash.slice(1));
    assert.equal(fragment.get("port"), String(relayPort));
    assert.equal(fragment.get("path"), "/auth/callback");
    assert.equal(
      fragment.get("search"),
      "?code=secret-code&state=expected-state",
    );
  } finally {
    relay.kill("SIGTERM");
  }
});
