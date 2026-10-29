import {
  createPrivateKey,
  createPublicKey,
  generateKeyPairSync,
  randomUUID,
  sign,
} from "node:crypto";
import fs from "node:fs";
import path from "node:path";

const ALGORITHM = "ecdsa_p256_sha256";
const PROTECTION_CLASS = "os_protected_nonextractable";
const SUPPORTED_POLICY = "allow_os_protected_nonextractable";
const KEY_ID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u;

type StoredDeviceKey = {
  version: 1;
  algorithm: typeof ALGORITHM;
  protectionClass: typeof PROTECTION_CLASS;
  publicKeySpkiDerBase64: string;
  privateKeyPkcs8Pem: string;
};

type PublicDeviceKey = {
  algorithm: typeof ALGORITHM;
  keyId: string;
  protectionClass: typeof PROTECTION_CLASS;
  publicKeySpkiDerBase64: string;
};

function keyDirectory(): string {
  const codexHome = process.env.CODEX_HOME;
  if (!codexHome) {
    throw new Error("Software device keys require CODEX_HOME");
  }
  return path.join(codexHome, "remote-control-device-keys");
}

function keyPath(keyId: string): string {
  if (!KEY_ID_PATTERN.test(keyId)) {
    throw new Error("invalid device key id");
  }
  return path.join(keyDirectory(), `${keyId}.json`);
}

function readKey(keyId: string): StoredDeviceKey {
  let value: unknown;
  try {
    value = JSON.parse(fs.readFileSync(keyPath(keyId), "utf8"));
  } catch (error) {
    if (error instanceof Error && "code" in error && error.code === "ENOENT") {
      throw new Error("device key not found");
    }
    throw error;
  }

  if (
    typeof value !== "object" ||
    value === null ||
    !("version" in value) ||
    value.version !== 1 ||
    !("algorithm" in value) ||
    value.algorithm !== ALGORITHM ||
    !("protectionClass" in value) ||
    value.protectionClass !== PROTECTION_CLASS ||
    !("publicKeySpkiDerBase64" in value) ||
    typeof value.publicKeySpkiDerBase64 !== "string" ||
    !("privateKeyPkcs8Pem" in value) ||
    typeof value.privateKeyPkcs8Pem !== "string"
  ) {
    throw new Error("stored device key is invalid");
  }

  return value as StoredDeviceKey;
}

function publicDeviceKey(
  keyId: string,
  stored: StoredDeviceKey,
): PublicDeviceKey {
  return {
    algorithm: ALGORITHM,
    keyId,
    protectionClass: PROTECTION_CLASS,
    publicKeySpkiDerBase64: stored.publicKeySpkiDerBase64,
  };
}

export function createDeviceKey(policy: string): PublicDeviceKey {
  if (policy !== SUPPORTED_POLICY) {
    throw new Error("unsupported device key protection policy");
  }

  fs.mkdirSync(keyDirectory(), { recursive: true, mode: 0o700 });

  const { privateKey, publicKey } = generateKeyPairSync("ec", {
    namedCurve: "prime256v1",
  });
  const stored: StoredDeviceKey = {
    version: 1,
    algorithm: ALGORITHM,
    protectionClass: PROTECTION_CLASS,
    publicKeySpkiDerBase64: publicKey
      .export({ format: "der", type: "spki" })
      .toString("base64"),
    privateKeyPkcs8Pem: privateKey
      .export({ format: "pem", type: "pkcs8" })
      .toString(),
  };

  for (;;) {
    const keyId = randomUUID();
    try {
      fs.writeFileSync(keyPath(keyId), JSON.stringify(stored), {
        encoding: "utf8",
        flag: "wx",
        mode: 0o600,
      });
      return publicDeviceKey(keyId, stored);
    } catch (error) {
      if (
        error instanceof Error &&
        "code" in error &&
        error.code === "EEXIST"
      ) {
        continue;
      }
      throw error;
    }
  }
}

export function deleteDeviceKey(keyId: string): void {
  try {
    fs.unlinkSync(keyPath(keyId));
  } catch (error) {
    if (error instanceof Error && "code" in error && error.code === "ENOENT") {
      return;
    }
    throw error;
  }
}

export function getDeviceKeyPublic(keyId: string): PublicDeviceKey {
  return publicDeviceKey(keyId, readKey(keyId));
}

export function signDeviceKey(
  keyId: string,
  payload: Buffer,
): {
  algorithm: typeof ALGORITHM;
  signatureDerBase64: string;
} {
  if (!Buffer.isBuffer(payload)) {
    throw new Error("signDeviceKey requires a key id and payload buffer");
  }

  const stored = readKey(keyId);
  const privateKey = createPrivateKey(stored.privateKeyPkcs8Pem);
  const derivedPublicKey = createPublicKey(privateKey)
    .export({ format: "der", type: "spki" })
    .toString("base64");
  if (derivedPublicKey !== stored.publicKeySpkiDerBase64) {
    throw new Error("stored device key public key does not match private key");
  }

  return {
    algorithm: ALGORITHM,
    signatureDerBase64: sign("sha256", payload, {
      key: privateKey,
      dsaEncoding: "der",
    }).toString("base64"),
  };
}
