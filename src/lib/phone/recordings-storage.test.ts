// PRD #304 — Nookleus Phone. Slice 9 (#313) — voice-recordings bucket I/O.
//
// The bucket layer behind voicemail playback. Pure shape + thin I/O over the
// Supabase Storage client, mirroring attachments-storage (slice 6). Org-scoping
// is enforced by the path prefix `{organization_id}/` and double-checked by the
// read policy on the phone-recordings bucket (migration-313). Voicemail audio
// is stored as MP3 (browser-playable in <audio>, smaller than Twilio's WAV).

import { describe, it, expect, vi } from "vitest";

import {
  PHONE_RECORDINGS_BUCKET,
  phoneRecordingPath,
  uploadPhoneRecording,
  signedUrlForPhoneRecording,
} from "./recordings-storage";

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

describe("phoneRecordingPath", () => {
  it("returns {org}/{uuid}.{ext}", () => {
    expect(phoneRecordingPath("org-1", "abc-uuid", "mp3")).toBe(
      "org-1/abc-uuid.mp3",
    );
  });
});

describe("PHONE_RECORDINGS_BUCKET", () => {
  it("is the documented bucket name", () => {
    expect(PHONE_RECORDINGS_BUCKET).toBe("phone-recordings");
  });
});

describe("uploadPhoneRecording", () => {
  it("uploads MP3 audio to the phone-recordings bucket and returns the storage path", async () => {
    const { client, bucket, uploads } = makeBucketFake();

    const result = await uploadPhoneRecording(client, {
      orgId: "org-1",
      bytes: new Uint8Array([1, 2, 3]),
    });

    expect(client.storage.from).toHaveBeenCalledWith("phone-recordings");
    expect(uploads).toHaveLength(1);
    expect(uploads[0].path).toMatch(/^org-1\/[0-9a-f-]+\.mp3$/);
    expect(uploads[0].options).toEqual({
      contentType: "audio/mpeg",
      upsert: false,
    });
    expect(result.storagePath).toEqual(uploads[0].path);
    expect(bucket.upload).toHaveBeenCalledOnce();
  });

  it("throws when the bucket returns an error", async () => {
    const client = {
      storage: {
        from: () => ({
          upload: async () => ({ data: null, error: { message: "bucket boom" } }),
        }),
      },
    } as const;

    await expect(
      uploadPhoneRecording(client as never, {
        orgId: "org-1",
        bytes: new Uint8Array([1]),
      }),
    ).rejects.toThrow(/bucket boom/);
  });
});

describe("signedUrlForPhoneRecording", () => {
  it("mints a signed URL for the path on the phone-recordings bucket", async () => {
    const { client, signed } = makeBucketFake();

    const url = await signedUrlForPhoneRecording(client, "org-1/abc.mp3", 60);

    expect(client.storage.from).toHaveBeenCalledWith("phone-recordings");
    expect(signed).toEqual(["org-1/abc.mp3"]);
    expect(url).toBe("https://signed.example/org-1/abc.mp3");
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
      signedUrlForPhoneRecording(client as never, "org-x/missing.mp3", 60),
    ).rejects.toThrow(/not found/);
  });
});
