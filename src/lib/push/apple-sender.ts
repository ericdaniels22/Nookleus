import { createPrivateKey, sign } from "crypto";
import { connect, constants } from "http2";

// Self-contained Apple Push (APNs) sender.
//
// `send(deviceTokens, payload, deps)` delivers one alert payload to a set of
// device tokens and returns a per-token outcome. It knows nothing about
// intakes, Organizations, or notifications — it just signs a request with the
// APNs auth key, hands each token to a transport, and reports what happened.
//
// The transport (the HTTP/2-to-Apple boundary) is dependency-injected so the
// sender can be exercised against a faked Apple in tests; the real transport
// (`createApnsTransport`) is verified end-to-end against a phone in the wiring
// slice.

export interface ApplePushPayload {
  title: string;
  body: string;
  sound: string;
  href: string;
}

export interface ApnsConfig {
  keyId: string;
  teamId: string;
  bundleId: string;
  privateKey: string;
}

export interface ApnsRequest {
  token: string;
  headers: Record<string, string>;
  body: string;
}

export interface ApnsResponse {
  status: number;
  reason?: string;
  apnsId?: string;
}

export type ApnsTransport = (req: ApnsRequest) => Promise<ApnsResponse>;

export type TokenOutcome =
  | { status: "sent"; token: string; apnsId: string | null }
  | { status: "prunable"; token: string; reason: string }
  | { status: "failed"; token: string; error: string };

// APNs reasons that mean the token is permanently dead and should be pruned
// rather than retried. A 410 (Unregistered) is the canonical signal; a 400
// BadDeviceToken means the address itself is invalid. (DeviceTokenNotForTopic
// is deliberately NOT here — it usually signals a topic misconfiguration, so
// pruning on it could wipe out otherwise-valid tokens.)
const PRUNABLE_REASONS = new Set(["Unregistered", "BadDeviceToken"]);

function isPrunable(res: ApnsResponse): boolean {
  return res.status === 410 || (!!res.reason && PRUNABLE_REASONS.has(res.reason));
}

export interface SendResult {
  summary: { sent: number; prunable: number; failed: number };
  outcomes: TokenOutcome[];
}

export interface SendDeps {
  // The Apple transport. Defaults to a real HTTP/2 client (`createApnsTransport`);
  // tests inject a fake.
  transport?: ApnsTransport;
  // APNs credentials. Defaults to `loadApnsConfigFromEnv()`.
  config?: ApnsConfig;
  // Unix seconds for the provider token's `iat` (injected for test determinism).
  now?: number;
}

// Apple's two APNs front doors. Production serves tokens from App Store / signed
// production builds; sandbox serves tokens from development / TestFlight builds.
// The .p8 auth key works for both — only the host distinguishes them.
export const APNS_HOSTS = {
  production: "api.push.apple.com",
  sandbox: "api.sandbox.push.apple.com",
} as const;

export interface ApnsTransportOptions {
  host?: string; // defaults to APNS_HOST env or the production host
  timeoutMs?: number; // per-request timeout; a hung connection becomes a failed outcome
}

// The real HTTP/2-to-Apple boundary. Receives a fully-formed (already-signed)
// request and ships it. Non-2xx responses are normal APNs outcomes and resolve
// (with the `reason` from the JSON body); only genuine transport failures
// reject — `send` contains those as `failed` outcomes. Not unit-tested here:
// it is exercised end-to-end against a real phone in the final wiring slice.
export function createApnsTransport(opts: ApnsTransportOptions = {}): ApnsTransport {
  const host = opts.host ?? process.env.APNS_HOST ?? APNS_HOSTS.production;
  const timeoutMs = opts.timeoutMs ?? 10_000;

  return (req) =>
    new Promise<ApnsResponse>((resolve, reject) => {
      const session = connect(`https://${host}`);
      const fail = (err: Error) => {
        session.destroy();
        reject(err);
      };
      session.on("error", fail);

      const stream = session.request({
        [constants.HTTP2_HEADER_METHOD]: "POST",
        [constants.HTTP2_HEADER_PATH]: `/3/device/${req.token}`,
        ...req.headers,
      });
      stream.setTimeout(timeoutMs, () =>
        fail(new Error(`APNs request timed out after ${timeoutMs}ms`)),
      );

      let status = 0;
      let apnsId: string | undefined;
      const chunks: Buffer[] = [];
      stream.on("response", (headers) => {
        status = Number(headers[constants.HTTP2_HEADER_STATUS] ?? 0);
        const id = headers["apns-id"];
        apnsId = Array.isArray(id) ? id[0] : (id as string | undefined);
      });
      stream.on("data", (c: Buffer) => chunks.push(Buffer.from(c)));
      stream.on("end", () => {
        let reason: string | undefined;
        if (chunks.length) {
          try {
            reason = JSON.parse(Buffer.concat(chunks).toString()).reason;
          } catch {
            /* a 200 carries no body */
          }
        }
        session.close();
        resolve({ status, reason, apnsId });
      });
      stream.on("error", fail);
      stream.end(req.body);
    });
}

function base64url(input: string | Buffer): string {
  return Buffer.from(input).toString("base64url");
}

// APNs authenticates each request with a short-lived JWT ("provider token")
// signed ES256 with the .p8 auth key. One token is minted per `send` and
// reused across all device tokens (Apple recommends reusing, not re-signing
// per request).
function buildProviderToken(config: ApnsConfig, nowSeconds: number): string {
  const header = base64url(JSON.stringify({ alg: "ES256", kid: config.keyId }));
  const claims = base64url(JSON.stringify({ iss: config.teamId, iat: nowSeconds }));
  const signingInput = `${header}.${claims}`;
  const signature = sign("sha256", Buffer.from(signingInput), {
    key: createPrivateKey(config.privateKey),
    dsaEncoding: "ieee-p1363", // JWS ES256 needs raw r||s, not DER
  });
  return `${signingInput}.${base64url(signature)}`;
}

function buildRequest(
  token: string,
  payload: ApplePushPayload,
  providerToken: string,
  config: ApnsConfig,
): ApnsRequest {
  return {
    token,
    headers: {
      authorization: `bearer ${providerToken}`,
      "apns-topic": config.bundleId,
      "apns-push-type": "alert",
      "apns-priority": "10",
    },
    body: JSON.stringify({
      aps: {
        alert: { title: payload.title, body: payload.body },
        sound: payload.sound,
      },
      href: payload.href,
    }),
  };
}

// Reads the APNs provider credentials from the server secrets configured in
// slice #670. Throws if any are missing — a deploy-time misconfiguration.
export function loadApnsConfigFromEnv(): ApnsConfig {
  const keyId = process.env.APNS_KEY_ID;
  const teamId = process.env.APNS_TEAM_ID;
  const bundleId = process.env.APNS_BUNDLE_ID;
  const privateKey = process.env.APNS_PRIVATE_KEY;
  if (!keyId || !teamId || !bundleId || !privateKey) {
    throw new Error(
      "APNs config is incomplete: set APNS_KEY_ID, APNS_TEAM_ID, APNS_BUNDLE_ID, APNS_PRIVATE_KEY",
    );
  }
  return { keyId, teamId, bundleId, privateKey };
}

function summarize(outcomes: TokenOutcome[]): SendResult["summary"] {
  return outcomes.reduce(
    (acc, o) => {
      if (o.status === "sent") acc.sent += 1;
      else if (o.status === "prunable") acc.prunable += 1;
      else acc.failed += 1;
      return acc;
    },
    { sent: 0, prunable: 0, failed: 0 },
  );
}

export async function send(
  deviceTokens: string[],
  payload: ApplePushPayload,
  deps: SendDeps,
): Promise<SendResult> {
  // Nothing to send: don't sign or load config when there are no recipients.
  if (deviceTokens.length === 0) {
    return { summary: summarize([]), outcomes: [] };
  }

  const config = deps.config ?? loadApnsConfigFromEnv();
  const transport = deps.transport ?? createApnsTransport();
  const nowSeconds = deps.now ?? Math.floor(Date.now() / 1000);
  const providerToken = buildProviderToken(config, nowSeconds);

  const outcomes: TokenOutcome[] = [];

  for (const token of deviceTokens) {
    try {
      const res = await transport(
        buildRequest(token, payload, providerToken, config),
      );
      if (res.status === 200) {
        outcomes.push({ status: "sent", token, apnsId: res.apnsId ?? null });
      } else if (isPrunable(res)) {
        outcomes.push({ status: "prunable", token, reason: res.reason ?? "Unregistered" });
      } else {
        // Any other non-OK response (429, 5xx, …): a real but non-fatal error.
        // Report it as failed so the token still gets exactly one outcome.
        outcomes.push({
          status: "failed",
          token,
          error: `APNs ${res.status}${res.reason ? `: ${res.reason}` : ""}`,
        });
      }
    } catch (e) {
      outcomes.push({
        status: "failed",
        token,
        error: e instanceof Error ? e.message : String(e),
      });
    }
  }

  return { summary: summarize(outcomes), outcomes };
}
