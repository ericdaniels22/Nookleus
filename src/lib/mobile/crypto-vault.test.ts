import { describe, it, expect, vi, beforeEach } from "vitest";
import { encrypt, decrypt } from "./crypto-vault";

vi.mock("capacitor-secure-storage-plugin", () => {
  let store: Record<string, string> = {};
  return {
    SecureStoragePlugin: {
      get: async ({ key }: { key: string }) => ({ value: store[key] ?? undefined }),
      set: async ({ key, value }: { key: string; value: string }) => {
        store[key] = value;
        return { value: true };
      },
    },
  };
});

beforeEach(() => {
  // ensure crypto.subtle is available in jsdom env
  if (!globalThis.crypto?.subtle) {
    globalThis.crypto = require("node:crypto").webcrypto as Crypto;
  }
});

describe("crypto-vault", () => {
  it("encrypts and decrypts a blob roundtrip", async () => {
    const plain = new Blob([new Uint8Array([1, 2, 3, 4, 5])], {
      type: "image/jpeg",
    });
    const encBlob = await encrypt(plain);
    expect(encBlob.size).toBeGreaterThan(plain.size); // IV + tag overhead
    const decBlob = await decrypt(encBlob);
    const out = new Uint8Array(await decBlob.arrayBuffer());
    expect(Array.from(out)).toEqual([1, 2, 3, 4, 5]);
  });

  it("encrypts produce different ciphertext on each call (random IV)", async () => {
    const plain = new Blob([new Uint8Array([9, 9, 9])]);
    const a = new Uint8Array(await (await encrypt(plain)).arrayBuffer());
    const b = new Uint8Array(await (await encrypt(plain)).arrayBuffer());
    expect(Array.from(a)).not.toEqual(Array.from(b)); // IV differs
  });

  it("concurrent encrypt calls share a single key (no race)", async () => {
    // Reset module state to force a fresh keygen path.
    vi.resetModules();
    const mod = await import("./crypto-vault");
    const plain = new Blob([new Uint8Array([7, 7, 7])]);

    // Fire two encrypts concurrently before either resolves
    const [encA, encB] = await Promise.all([mod.encrypt(plain), mod.encrypt(plain)]);

    // Both should round-trip through the SAME key — decrypt either with the
    // module's decrypt and we get [7, 7, 7] back.
    const outA = new Uint8Array(await (await mod.decrypt(encA)).arrayBuffer());
    const outB = new Uint8Array(await (await mod.decrypt(encB)).arrayBuffer());
    expect(Array.from(outA)).toEqual([7, 7, 7]);
    expect(Array.from(outB)).toEqual([7, 7, 7]);
  });
});
