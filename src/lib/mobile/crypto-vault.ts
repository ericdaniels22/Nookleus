import { SecureStoragePlugin as SecureStorage } from "capacitor-secure-storage-plugin";
import { Directory, Filesystem } from "@capacitor/filesystem";

const KEYCHAIN_KEY = "nookleus.upload-queue.aes-256-gcm.v1";
const IV_LEN = 12;

let keyPromise: Promise<CryptoKey> | null = null;

function getOrCreateKey(): Promise<CryptoKey> {
  if (keyPromise) return keyPromise;
  keyPromise = loadOrGenerateKey();
  // If the load fails, clear the cache so the next call retries.
  keyPromise.catch(() => {
    keyPromise = null;
  });
  return keyPromise;
}

async function loadOrGenerateKey(): Promise<CryptoKey> {
  const existing = await SecureStorage.get({ key: KEYCHAIN_KEY }).catch(() => null);
  let rawB64 = existing?.value ?? null;

  if (!rawB64) {
    const generated = await crypto.subtle.generateKey(
      { name: "AES-GCM", length: 256 },
      true,
      ["encrypt", "decrypt"],
    );
    const exported = await crypto.subtle.exportKey("raw", generated);
    rawB64 = bufToBase64(exported);
    await SecureStorage.set({ key: KEYCHAIN_KEY, value: rawB64 });
  }

  const rawBuf = base64ToBuf(rawB64);
  return crypto.subtle.importKey(
    "raw",
    rawBuf,
    { name: "AES-GCM", length: 256 },
    false,
    ["encrypt", "decrypt"],
  );
}

export async function encrypt(blob: Blob): Promise<Blob> {
  const key = await getOrCreateKey();
  const iv = crypto.getRandomValues(new Uint8Array(IV_LEN));
  const ct = await crypto.subtle.encrypt(
    { name: "AES-GCM", iv },
    key,
    await blob.arrayBuffer(),
  );
  return new Blob([iv, ct]);
}

export async function decrypt(encBlob: Blob): Promise<Blob> {
  const key = await getOrCreateKey();
  const buf = await encBlob.arrayBuffer();
  const iv = new Uint8Array(buf, 0, IV_LEN);
  const ct = new Uint8Array(buf, IV_LEN);
  const plain = await crypto.subtle.decrypt({ name: "AES-GCM", iv }, key, ct);
  return new Blob([plain], { type: "image/jpeg" });
}

/**
 * One-time scan: encrypt any leftover unencrypted .jpg files from 65b smoke
 * sessions. Safe to run repeatedly; idempotent.
 */
export async function migrateUnencryptedFiles(): Promise<{
  encrypted: number;
  skipped: number;
}> {
  let encrypted = 0;
  let skipped = 0;

  const root = "pending-uploads";
  let jobDirs: string[] = [];
  try {
    const r = await Filesystem.readdir({
      path: root,
      directory: Directory.Documents,
    });
    jobDirs = r.files.map((f) => (typeof f === "string" ? f : f.name));
  } catch {
    return { encrypted, skipped };
  }

  for (const jobDir of jobDirs) {
    const sessions = await Filesystem.readdir({
      path: `${root}/${jobDir}`,
      directory: Directory.Documents,
    }).catch(() => ({ files: [] as Array<string | { name: string }> }));

    for (const sessRaw of sessions.files) {
      const sess = typeof sessRaw === "string" ? sessRaw : sessRaw.name;
      const filesR = await Filesystem.readdir({
        path: `${root}/${jobDir}/${sess}`,
        directory: Directory.Documents,
      }).catch(() => ({ files: [] as Array<string | { name: string }> }));

      const names = filesR.files.map((f) => (typeof f === "string" ? f : f.name));
      const jpgs = names.filter((n) => n.endsWith(".jpg"));

      for (const jpg of jpgs) {
        const enc = jpg + ".enc";
        const path = `${root}/${jobDir}/${sess}/${jpg}`;
        const encPath = `${root}/${jobDir}/${sess}/${enc}`;

        if (names.includes(enc)) {
          // Already migrated; just delete the stale plaintext.
          await Filesystem.deleteFile({ path, directory: Directory.Documents });
          skipped++;
          continue;
        }

        const r = await Filesystem.readFile({
          path,
          directory: Directory.Documents,
        });
        const b64 = typeof r.data === "string" ? r.data : await blobToBase64(r.data);
        const plain = base64ToBlob(b64, "image/jpeg");
        const encBlob = await encrypt(plain);
        const encB64 = bufToBase64(await encBlob.arrayBuffer());
        await Filesystem.writeFile({
          path: encPath,
          data: encB64,
          directory: Directory.Documents,
        });
        await Filesystem.deleteFile({ path, directory: Directory.Documents });
        encrypted++;
      }
    }
  }

  return { encrypted, skipped };
}

function bufToBase64(buf: ArrayBuffer): string {
  const bytes = new Uint8Array(buf);
  let bin = "";
  for (let i = 0; i < bytes.byteLength; i++) bin += String.fromCharCode(bytes[i]);
  return btoa(bin);
}

function base64ToBuf(b64: string): ArrayBuffer {
  const bin = atob(b64);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return bytes.buffer;
}

function base64ToBlob(b64: string, type: string): Blob {
  return new Blob([base64ToBuf(b64)], { type });
}

async function blobToBase64(blob: Blob): Promise<string> {
  return bufToBase64(await blob.arrayBuffer());
}
