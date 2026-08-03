import assert from "node:assert/strict";
import test from "node:test";
import { WebSocket } from "ws";

import {
  RENDERER_TAKEOVER_CLOSE_CODE,
  RendererSessionCoordinator,
} from "../src/server/renderer-session.js";

function fakeSocket() {
  return {
    readyState: WebSocket.OPEN,
    closed: null,
    messages: [],
    close(code, reason) {
      this.closed = { code, reason };
      this.readyState = WebSocket.CLOSED;
    },
    send(message) {
      this.messages.push(message);
    },
  };
}

test("a new renderer atomically takes ownership from the previous renderer", () => {
  const coordinator = new RendererSessionCoordinator();
  const first = fakeSocket();
  const second = fakeSocket();
  let firstDisposeCount = 0;

  coordinator.claim(first, () => {
    firstDisposeCount += 1;
  });
  coordinator.send("first");
  coordinator.claim(second, () => undefined);
  coordinator.send("second");

  assert.equal(firstDisposeCount, 1);
  assert.equal(first.closed?.code, RENDERER_TAKEOVER_CLOSE_CODE);
  assert.deepEqual(first.messages, ["first"]);
  assert.deepEqual(second.messages, ["second"]);
});

test("a stale socket close cannot release the active renderer", () => {
  const coordinator = new RendererSessionCoordinator();
  const first = fakeSocket();
  const second = fakeSocket();

  coordinator.claim(first, () => undefined);
  coordinator.claim(second, () => undefined);
  coordinator.release(first);
  coordinator.send("still-active");

  assert.deepEqual(second.messages, ["still-active"]);
});
