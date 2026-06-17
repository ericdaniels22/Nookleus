import { describe, it, expect, vi, afterEach } from "vitest";
import { generateKeyPairSync, verify, type KeyObject } from "crypto";
import {
  send,
  loadApnsConfigFromEnv,
  type ApnsConfig,
  type ApnsRequest,
  type ApnsTransport,
  type ApplePushPayload,
} from "./apple-sender";

// A throwaway EC P-256 keypair so the real signing path runs in tests
// without needing the production .p8 secret. `.p8` files are PKCS#8 PEM,
// which is exactly what `export({ type: "pkcs8", format: "pem" })` yields.
function makeTestKeypair(): { config: ApnsConfig; publicKey: KeyObject } {
  const { privateKey, publicKey } = generateKeyPairSync("ec", {
    namedCurve: "P-256",
  });
  return {
    config: {
      keyId: "TESTKEY123",
      teamId: "TEAMID9999",
      bundleId: "com.example.app",
      privateKey: privateKey.export({ type: "pkcs8", format: "pem" }).toString(),
    },
    publicKey,
  };
}

function makeTestConfig(): ApnsConfig {
  return makeTestKeypair().config;
}

function decodeSegment(seg: string): Record<string, unknown> {
  return JSON.parse(Buffer.from(seg, "base64url").toString("utf8"));
}

const payload: ApplePushPayload = {
  title: "New intake: Jane",
  body: "Water damage · 123 Main St",
  sound: "default.caf",
  href: "/jobs/job-1",
};

describe("loadApnsConfigFromEnv — #670 secrets contract", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("reads the four APNS_* server secrets into a config", () => {
    vi.stubEnv("APNS_KEY_ID", "NZK3A4PTWB");
    vi.stubEnv("APNS_TEAM_ID", "QFTG9NJB7G");
    vi.stubEnv("APNS_BUNDLE_ID", "com.aaacontracting.platform");
    vi.stubEnv("APNS_PRIVATE_KEY", "-----BEGIN PRIVATE KEY-----\nx\n-----END PRIVATE KEY-----");

    expect(loadApnsConfigFromEnv()).toEqual({
      keyId: "NZK3A4PTWB",
      teamId: "QFTG9NJB7G",
      bundleId: "com.aaacontracting.platform",
      privateKey: "-----BEGIN PRIVATE KEY-----\nx\n-----END PRIVATE KEY-----",
    });
  });

  it("throws naming the missing secret when one is absent", () => {
    vi.stubEnv("APNS_KEY_ID", "NZK3A4PTWB");
    vi.stubEnv("APNS_TEAM_ID", "QFTG9NJB7G");
    vi.stubEnv("APNS_BUNDLE_ID", "com.aaacontracting.platform");
    vi.stubEnv("APNS_PRIVATE_KEY", "");

    expect(() => loadApnsConfigFromEnv()).toThrow(/APNS_PRIVATE_KEY/);
  });
});

describe("send — successful delivery", () => {
  it("reports a 200 response as a 'sent' outcome per token", async () => {
    const transport: ApnsTransport = async () => ({ status: 200, apnsId: "apns-1" });

    const result = await send(["tok-1"], payload, {
      transport,
      config: makeTestConfig(),
    });

    expect(result.summary).toEqual({ sent: 1, prunable: 0, failed: 0 });
    expect(result.outcomes).toEqual([
      { status: "sent", token: "tok-1", apnsId: "apns-1" },
    ]);
  });
});

describe("send — dead / unregistered address", () => {
  it("surfaces a 410 Unregistered response as a 'prunable' outcome, not an error", async () => {
    const transport: ApnsTransport = async () => ({
      status: 410,
      reason: "Unregistered",
    });

    const result = await send(["dead-tok"], payload, {
      transport,
      config: makeTestConfig(),
    });

    expect(result.summary).toEqual({ sent: 0, prunable: 1, failed: 0 });
    expect(result.outcomes).toEqual([
      { status: "prunable", token: "dead-tok", reason: "Unregistered" },
    ]);
  });
});

describe("send — contained transport error", () => {
  it("reports a thrown transport error as 'failed' and never throws to the caller", async () => {
    const transport: ApnsTransport = async () => {
      throw new Error("ECONNRESET: connection to Apple dropped");
    };

    const result = await send(["tok-1"], payload, {
      transport,
      config: makeTestConfig(),
    });

    expect(result.summary).toEqual({ sent: 0, prunable: 0, failed: 1 });
    expect(result.outcomes).toEqual([
      {
        status: "failed",
        token: "tok-1",
        error: expect.stringContaining("ECONNRESET"),
      },
    ]);
  });
});

describe("send — signed request to Apple", () => {
  it("signs each request with a valid ES256 provider token and the configured topic", async () => {
    const { config, publicKey } = makeTestKeypair();

    let captured: ApnsRequest | undefined;
    const transport: ApnsTransport = async (req) => {
      captured = req;
      return { status: 200, apnsId: "apns-1" };
    };

    await send(["tok-1"], payload, { transport, config, now: 1_700_000_000 });

    expect(captured).toBeDefined();
    const req = captured!;

    // The push topic is the configured bundle id.
    expect(req.headers["apns-topic"]).toBe("com.example.app");
    expect(req.headers["apns-push-type"]).toBe("alert");

    // Authorization carries a bearer provider token (a JWS: header.claims.sig).
    const auth = req.headers["authorization"];
    expect(auth).toMatch(/^bearer .+\..+\..+$/);
    const jwt = auth.slice("bearer ".length);
    const [headerB64, claimsB64, sigB64] = jwt.split(".");

    // The signature verifies against the auth key's public half (ES256 = raw r||s).
    const signingInput = `${headerB64}.${claimsB64}`;
    const valid = verify(
      "sha256",
      Buffer.from(signingInput),
      { key: publicKey, dsaEncoding: "ieee-p1363" },
      Buffer.from(sigB64, "base64url"),
    );
    expect(valid).toBe(true);

    // Header identifies the key; claims identify the team + issue time.
    expect(decodeSegment(headerB64)).toMatchObject({ alg: "ES256", kid: "TESTKEY123" });
    expect(decodeSegment(claimsB64)).toMatchObject({
      iss: "TEAMID9999",
      iat: 1_700_000_000,
    });

    // The aps body carries the alert wording + sound and the deep-link data.
    const body = JSON.parse(req.body);
    expect(body.aps.alert).toEqual({ title: payload.title, body: payload.body });
    expect(body.aps.sound).toBe("default.caf");
    expect(body.href).toBe("/jobs/job-1");
  });
});

describe("send — mixed batch", () => {
  it("returns one outcome per token in order and tallies the summary across kinds", async () => {
    const seen: ApnsRequest[] = [];
    const transport: ApnsTransport = async (req) => {
      seen.push(req);
      if (req.token === "ok-tok") return { status: 200, apnsId: "apns-ok" };
      if (req.token === "dead-tok") return { status: 410, reason: "Unregistered" };
      throw new Error("ETIMEDOUT");
    };

    const result = await send(["ok-tok", "dead-tok", "boom-tok"], payload, {
      transport,
      config: makeTestConfig(),
    });

    expect(result.summary).toEqual({ sent: 1, prunable: 1, failed: 1 });
    expect(result.outcomes.map((o) => [o.token, o.status])).toEqual([
      ["ok-tok", "sent"],
      ["dead-tok", "prunable"],
      ["boom-tok", "failed"],
    ]);

    // One provider token is minted per send and reused for every device token.
    const auths = new Set(seen.map((r) => r.headers["authorization"]));
    expect(auths.size).toBe(1);
  });
});

describe("send — non-dead error response", () => {
  it("reports a 429/5xx APNs error response as 'failed' (every token gets an outcome)", async () => {
    const transport: ApnsTransport = async () => ({
      status: 429,
      reason: "TooManyRequests",
    });

    const result = await send(["busy-tok"], payload, {
      transport,
      config: makeTestConfig(),
    });

    expect(result.summary).toEqual({ sent: 0, prunable: 0, failed: 1 });
    expect(result.outcomes).toHaveLength(1);
    const [outcome] = result.outcomes;
    expect(outcome).toMatchObject({ status: "failed", token: "busy-tok" });
    expect(outcome.status === "failed" && outcome.error).toEqual(
      expect.stringContaining("429"),
    );
    expect(outcome.status === "failed" && outcome.error).toEqual(
      expect.stringContaining("TooManyRequests"),
    );
  });
});

describe("send — bad device token", () => {
  it("surfaces a 400 BadDeviceToken as 'prunable' (a dead address), not failed", async () => {
    const transport: ApnsTransport = async () => ({
      status: 400,
      reason: "BadDeviceToken",
    });

    const result = await send(["garbage-tok"], payload, {
      transport,
      config: makeTestConfig(),
    });

    expect(result.summary).toEqual({ sent: 0, prunable: 1, failed: 0 });
    expect(result.outcomes).toEqual([
      { status: "prunable", token: "garbage-tok", reason: "BadDeviceToken" },
    ]);
  });
});

describe("send — no device tokens", () => {
  it("returns an empty result without ever calling the transport", async () => {
    let calls = 0;
    const transport: ApnsTransport = async () => {
      calls += 1;
      return { status: 200, apnsId: "x" };
    };

    const result = await send([], payload, { transport, config: makeTestConfig() });

    expect(calls).toBe(0);
    expect(result.summary).toEqual({ sent: 0, prunable: 0, failed: 0 });
    expect(result.outcomes).toEqual([]);
  });
});
