import assert from "node:assert/strict";
import test from "node:test";

import { WebSocketMessagePort } from "../src/server/websocket-message-port.js";

test("MessagePort buffers renderer messages until the main listener exists", () => {
  const outgoing = [];
  const received = [];
  const port = new WebSocketMessagePort(
    "renderer-port",
    (message) => outgoing.push(message),
    () => undefined,
  );

  port.receiveMessage("early");
  port.on("message", (event) => received.push(event.data));
  port.receiveMessage("live");
  port.postMessage("reply");

  assert.deepEqual(received, ["early", "live"]);
  assert.deepEqual(outgoing, [
    {
      type: "message-port-message",
      portId: "renderer-port",
      data: "reply",
    },
  ]);
});

test("MessagePort disconnect clears buffered messages and emits close", () => {
  let closeCount = 0;
  const received = [];
  const port = new WebSocketMessagePort(
    "renderer-port",
    () => undefined,
    () => undefined,
  );

  port.receiveMessage("discarded");
  port.on("close", () => {
    closeCount += 1;
  });
  port.disconnect();
  port.on("message", (event) => received.push(event.data));

  assert.equal(closeCount, 1);
  assert.deepEqual(received, []);
});
