import assert from "node:assert/strict";
import { createPublicKey, verify } from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import {
  createDeviceKey,
  deleteDeviceKey,
  getDeviceKeyPublic,
  signDeviceKey,
} from "../src/server/software-device-key.js";

test("software device keys persist and create valid P-256 signatures", () => {
  const previousCodexHome = process.env.CODEX_HOME;
  const codexHome = fs.mkdtempSync(
    path.join(os.tmpdir(), "codex-web-device-key-"),
  );
  process.env.CODEX_HOME = codexHome;

  try {
    const created = createDeviceKey("allow_os_protected_nonextractable");
    assert.equal(created.algorithm, "ecdsa_p256_sha256");
    assert.equal(created.protectionClass, "os_protected_nonextractable");
    assert.deepEqual(getDeviceKeyPublic(created.keyId), created);

    const keyFile = path.join(
      codexHome,
      "remote-control-device-keys",
      `${created.keyId}.json`,
    );
    assert.equal(fs.statSync(keyFile).mode & 0o777, 0o600);

    const payload = Buffer.from("remote-control proof");
    const signature = signDeviceKey(created.keyId, payload);
    assert.equal(signature.algorithm, "ecdsa_p256_sha256");
    assert.equal(
      verify(
        "sha256",
        payload,
        createPublicKey({
          format: "der",
          key: Buffer.from(created.publicKeySpkiDerBase64, "base64"),
          type: "spki",
        }),
        Buffer.from(signature.signatureDerBase64, "base64"),
      ),
      true,
    );

    deleteDeviceKey(created.keyId);
    assert.throws(
      () => getDeviceKeyPublic(created.keyId),
      /device key not found/u,
    );
  } finally {
    if (previousCodexHome === undefined) {
      delete process.env.CODEX_HOME;
    } else {
      process.env.CODEX_HOME = previousCodexHome;
    }
    fs.rmSync(codexHome, { recursive: true, force: true });
  }
});

test("software device keys reject a hardware-only policy", () => {
  assert.throws(
    () => createDeviceKey("hardware_only"),
    /unsupported device key protection policy/u,
  );
});
