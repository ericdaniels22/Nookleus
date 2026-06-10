// PRD #304 — Nookleus Phone. Slice 13 (#317) — voicemail-greeting storage.
//
// The bucket layer behind a number's custom voicemail greeting. A greeting is
// short audio the voice webhook <Play>s before <Record>. One greeting per
// number, so the object path is deterministic ({org}/{number}.{ext}) and
// upserts on re-record. Twilio's <Play> only accepts mp3/wav, so validation
// rejects anything else at the door (the record-in-browser UI emits WAV).

import { describe, it, expect, vi } from "vitest";

import {
  PHONE_VOICEMAIL_GREETINGS_BUCKET,
  voicemailGreetingPath,
  validateVoicemailGreeting,
  uploadVoicemailGreeting,
  signedUrlForVoicemailGreeting,
  removeVoicemailGreeting,
  VOICEMAIL_GREETING_MAX_BYTES,
} from "./voicemail-greeting-storage";

// Minimal fake of the bucket-client surface the helpers touch.
function makeBucketFake() {
  const uploads: Array<{
    path: string;
    body: unknown;
    options: { contentType?: string; upsert?: boolean } | undefined;
  }> = [];
  const signed: string[] = [];
  const removed: string[][] = [];
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
      return {
        data: { signedUrl: `https://signed.example/${path}` },
        error: null,
      };
    }),
    remove: vi.fn(async (paths: string[]) => {
      removed.push(paths);
      return { data: [], error: null };
    }),
  };
  const client = {
    storage: { from: vi.fn(() => bucket) },
  } as const;
  return { client, bucket, uploads, signed, removed };
}

describe("voicemailGreetingPath", () => {
  it("returns {org}/{number}.{ext} — one deterministic object per number", () => {
    expect(voicemailGreetingPath("org-1", "num-1", "wav")).toBe(
      "org-1/num-1.wav",
    );
  });
});

describe("PHONE_VOICEMAIL_GREETINGS_BUCKET", () => {
  it("is the documented bucket name", () => {
    expect(PHONE_VOICEMAIL_GREETINGS_BUCKET).toBe("phone-voicemail-greetings");
  });
});

describe("validateVoicemailGreeting", () => {
  it("accepts wav and returns the wav extension", () => {
    expect(validateVoicemailGreeting({ type: "audio/wav", size: 1024 })).toEqual(
      { ok: true, ext: "wav", contentType: "audio/wav" },
    );
  });

  it("accepts mpeg and maps it to the mp3 extension", () => {
    expect(
      validateVoicemailGreeting({ type: "audio/mpeg", size: 1024 }),
    ).toEqual({ ok: true, ext: "mp3", contentType: "audio/mpeg" });
  });

  it("rejects a webm recording — Twilio <Play> cannot render it", () => {
    const result = validateVoicemailGreeting({ type: "audio/webm", size: 1024 });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toMatch(/MP3 or WAV/i);
  });

  it("rejects an empty file", () => {
    expect(validateVoicemailGreeting({ type: "audio/wav", size: 0 }).ok).toBe(
      false,
    );
  });

  it("rejects a file over the size cap", () => {
    const result = validateVoicemailGreeting({
      type: "audio/wav",
      size: VOICEMAIL_GREETING_MAX_BYTES + 1,
    });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toMatch(/too large/i);
  });
});

describe("uploadVoicemailGreeting", () => {
  it("upserts to the greetings bucket at {org}/{number}.{ext}", async () => {
    const { client, bucket, uploads } = makeBucketFake();

    const result = await uploadVoicemailGreeting(client, {
      orgId: "org-1",
      numberId: "num-1",
      ext: "wav",
      contentType: "audio/wav",
      bytes: new Uint8Array([1, 2, 3]),
    });

    expect(client.storage.from).toHaveBeenCalledWith(
      "phone-voicemail-greetings",
    );
    expect(uploads).toHaveLength(1);
    expect(uploads[0].path).toBe("org-1/num-1.wav");
    // upsert:true so a re-record overwrites the number's single greeting.
    expect(uploads[0].options).toEqual({
      contentType: "audio/wav",
      upsert: true,
    });
    expect(result.storagePath).toBe("org-1/num-1.wav");
    expect(bucket.upload).toHaveBeenCalledOnce();
  });

  it("throws when the bucket returns an error", async () => {
    const client = {
      storage: {
        from: () => ({
          upload: async () => ({ data: null, error: { message: "boom" } }),
        }),
      },
    } as const;

    await expect(
      uploadVoicemailGreeting(client as never, {
        orgId: "org-1",
        numberId: "num-1",
        ext: "wav",
        contentType: "audio/wav",
        bytes: new Uint8Array([1]),
      }),
    ).rejects.toThrow(/boom/);
  });
});

describe("signedUrlForVoicemailGreeting", () => {
  it("mints a signed URL for the path on the greetings bucket", async () => {
    const { client, signed } = makeBucketFake();

    const url = await signedUrlForVoicemailGreeting(
      client,
      "org-1/num-1.wav",
      3600,
    );

    expect(client.storage.from).toHaveBeenCalledWith(
      "phone-voicemail-greetings",
    );
    expect(signed).toEqual(["org-1/num-1.wav"]);
    expect(url).toBe("https://signed.example/org-1/num-1.wav");
  });
});

describe("removeVoicemailGreeting", () => {
  it("removes the object from the greetings bucket", async () => {
    const { client, removed } = makeBucketFake();

    await removeVoicemailGreeting(client, "org-1/num-1.wav");

    expect(client.storage.from).toHaveBeenCalledWith(
      "phone-voicemail-greetings",
    );
    expect(removed).toEqual([["org-1/num-1.wav"]]);
  });
});
