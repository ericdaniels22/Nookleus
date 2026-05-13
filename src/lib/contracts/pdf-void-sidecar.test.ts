import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("./pdf-void-watermark", () => ({
  stampVoidWatermark: vi.fn(async () => new Uint8Array([1, 2, 3, 4])),
}));

import {
  writeVoidWatermarkSidecar,
  computeVoidSidecarPath,
} from "./pdf-void-sidecar";

interface PendingError {
  message: string;
}

interface StorageState {
  blobs: Record<string, Uint8Array>;
  downloads: { bucket: string; path: string }[];
  uploads: {
    bucket: string;
    path: string;
    bytes: Uint8Array;
    options?: unknown;
  }[];
  downloadError?: PendingError | null;
  uploadError?: PendingError | null;
}

function makeFake(seed: Partial<StorageState> = {}) {
  const state: StorageState = {
    blobs: seed.blobs ?? {},
    downloads: [],
    uploads: [],
    downloadError: seed.downloadError ?? null,
    uploadError: seed.uploadError ?? null,
  };

  const client = {
    storage: {
      from(bucket: string) {
        return {
          async download(path: string) {
            state.downloads.push({ bucket, path });
            if (state.downloadError) {
              return { data: null, error: state.downloadError };
            }
            const bytes = state.blobs[`${bucket}/${path}`];
            if (!bytes) {
              return {
                data: null,
                error: { message: `not found: ${bucket}/${path}` },
              };
            }
            return {
              data: {
                async arrayBuffer() {
                  return bytes.buffer.slice(
                    bytes.byteOffset,
                    bytes.byteOffset + bytes.byteLength,
                  );
                },
              },
              error: null,
            };
          },
          async upload(path: string, data: Uint8Array, options?: unknown) {
            state.uploads.push({ bucket, path, bytes: data, options });
            if (state.uploadError) {
              return { data: null, error: state.uploadError };
            }
            return { data: { path }, error: null };
          },
        };
      },
    },
  };

  return { client, state };
}

describe("computeVoidSidecarPath", () => {
  it("appends '.voided.pdf' to the canonical key", () => {
    expect(computeVoidSidecarPath("org-1/c-1-signed.pdf")).toBe(
      "org-1/c-1-signed.pdf.voided.pdf",
    );
  });
});

describe("writeVoidWatermarkSidecar", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("downloads canonical PDF, stamps it, uploads stamped bytes to sidecar key, leaves canonical untouched", async () => {
    const canonical = new Uint8Array([0x25, 0x50, 0x44, 0x46]); // "%PDF"
    const fake = makeFake({
      blobs: { "contracts/org-1/c-1-signed.pdf": canonical },
    });

    const result = await writeVoidWatermarkSidecar(
      fake.client as never,
      "org-1/c-1-signed.pdf",
    );

    expect(result.sidecarPath).toBe("org-1/c-1-signed.pdf.voided.pdf");

    expect(fake.state.downloads).toEqual([
      { bucket: "contracts", path: "org-1/c-1-signed.pdf" },
    ]);

    expect(fake.state.uploads).toHaveLength(1);
    expect(fake.state.uploads[0].bucket).toBe("contracts");
    expect(fake.state.uploads[0].path).toBe(
      "org-1/c-1-signed.pdf.voided.pdf",
    );
    expect(fake.state.uploads[0].bytes).toEqual(new Uint8Array([1, 2, 3, 4]));

    const canonicalUploads = fake.state.uploads.filter(
      (u) => u.path === "org-1/c-1-signed.pdf",
    );
    expect(canonicalUploads).toHaveLength(0);
  });

  it("throws when the canonical PDF cannot be downloaded", async () => {
    const fake = makeFake({
      downloadError: { message: "object not found" },
    });

    await expect(
      writeVoidWatermarkSidecar(fake.client as never, "missing/path.pdf"),
    ).rejects.toThrow(/missing\/path\.pdf|failed to load|object not found/i);

    expect(fake.state.uploads).toHaveLength(0);
  });

  it("throws when the sidecar upload returns an error", async () => {
    const canonical = new Uint8Array([0x25, 0x50, 0x44, 0x46]);
    const fake = makeFake({
      blobs: { "contracts/org-1/c-1-signed.pdf": canonical },
      uploadError: { message: "quota exceeded" },
    });

    await expect(
      writeVoidWatermarkSidecar(fake.client as never, "org-1/c-1-signed.pdf"),
    ).rejects.toThrow(/quota exceeded|upload failed/i);
  });
});
