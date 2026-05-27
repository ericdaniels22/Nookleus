// PRD #304 — Nookleus Phone. Slice 6 (#310) — storage helpers.
//
// The bucket layer behind the MMS pipeline. Pure shape + thin I/O over
// the Supabase Storage client. Org-scoping is enforced by the path prefix
// (and double-checked by the read policy on the bucket).

import { describe, it, expect, vi } from "vitest";

import {
  PHONE_ATTACHMENTS_BUCKET,
  phoneAttachmentPath,
  uploadPhoneAttachment,
  signedUrlForPhoneAttachment,
} from "./attachments-storage";

// Minimal fake of the bucket-client surface the helpers touch.
function makeBucketFake() {
  const uploads: Array<{
    path: string;
    body: unknown;
    options: { contentType?: string; upsert?: boolean } | undefined;
  }> = [];
  const signed: string[] = [];
  const bucket = {
    upload: vi.fn(
      async (
        path: string,
        body: unknown,
        options?: { contentType?: string; upsert?: boolean },
      ) => {
        uploads.push({ path, body, options });
        return { data: { path }, error: null };
      },
    ),
    createSignedUrl: vi.fn(async (path: string) => {
      signed.push(path);
      return { data: { signedUrl: `https://signed.example/${path}` }, error: null };
    }),
  };
  const client = {
    storage: { from: vi.fn(() => bucket) },
  } as const;
  return { client, bucket, uploads, signed };
}

describe("phoneAttachmentPath", () => {
  it("returns {org}/{uuid}.{ext}", () => {
    expect(phoneAttachmentPath("org-1", "abc-uuid", "jpg")).toBe(
      "org-1/abc-uuid.jpg",
    );
  });
});

describe("PHONE_ATTACHMENTS_BUCKET", () => {
  it("is the documented bucket name", () => {
    expect(PHONE_ATTACHMENTS_BUCKET).toBe("phone-attachments");
  });
});

describe("uploadPhoneAttachment", () => {
  it("uploads to the phone-attachments bucket and returns the storage path", async () => {
    const { client, bucket, uploads } = makeBucketFake();

    const result = await uploadPhoneAttachment(client, {
      orgId: "org-1",
      mediaType: "image/jpeg",
      bytes: new Uint8Array([1, 2, 3]),
    });

    expect(client.storage.from).toHaveBeenCalledWith("phone-attachments");
    expect(uploads).toHaveLength(1);
    expect(uploads[0].path).toMatch(/^org-1\/[0-9a-f-]+\.jpg$/);
    expect(uploads[0].options).toEqual({
      contentType: "image/jpeg",
      upsert: false,
    });
    expect(result.storagePath).toEqual(uploads[0].path);
    expect(result.mediaType).toBe("image/jpeg");
    expect(bucket.upload).toHaveBeenCalledOnce();
  });

  it("throws when the bucket returns an error", async () => {
    const client = {
      storage: {
        from: () => ({
          upload: async () => ({
            data: null,
            error: { message: "bucket boom" },
          }),
        }),
      },
    } as const;

    await expect(
      uploadPhoneAttachment(client as never, {
        orgId: "org-1",
        mediaType: "image/png",
        bytes: new Uint8Array([1]),
      }),
    ).rejects.toThrow(/bucket boom/);
  });
});

describe("signedUrlForPhoneAttachment", () => {
  it("mints a signed URL for the path on the phone-attachments bucket", async () => {
    const { client, signed } = makeBucketFake();

    const url = await signedUrlForPhoneAttachment(
      client,
      "org-1/abc.jpg",
      60,
    );

    expect(client.storage.from).toHaveBeenCalledWith("phone-attachments");
    expect(signed).toEqual(["org-1/abc.jpg"]);
    expect(url).toBe("https://signed.example/org-1/abc.jpg");
  });

  it("throws when the signing call fails", async () => {
    const client = {
      storage: {
        from: () => ({
          createSignedUrl: async () => ({
            data: null,
            error: { message: "not found" },
          }),
        }),
      },
    } as const;

    await expect(
      signedUrlForPhoneAttachment(client as never, "org-x/missing.jpg", 60),
    ).rejects.toThrow(/not found/);
  });
});
