// The WordPress REST client for the Website connection (#612). No SDK: the
// WordPress REST API is clean REST and the credential is HTTP Basic auth (a
// WordPress Application Password), so raw fetch — injected for testability —
// is all this needs. Mirrors the shape of src/lib/google/oauth.ts.
//
// The one signal the deep module branches on is isRevokedError(): a 401 means
// the Application Password was revoked or changed on the WordPress side, or the
// user lost publish rights — the connection is broken and the UI must prompt a
// reconnect. EVERY other failure (4xx misconfig, 5xx, network) is transient, so
// isRevokedError() returns false and the connection is never falsely broken.

// A failed WordPress REST call. `status` carries the HTTP status so the deep
// module can tell a permanent credential failure (401) from a transient one,
// and `code` carries WordPress's own error code (e.g. "incorrect_password")
// for logging/diagnosis. Mirrors GoogleOAuthError in src/lib/google/oauth.ts.
export class WordPressError extends Error {
  readonly status: number;
  readonly code: string;
  constructor(status: number, code: string, message: string) {
    super(message);
    this.name = "WordPressError";
    this.status = status;
    this.code = code;
  }
}

// The single signal the deep module branches on: was this failure a rejected
// credential (the Application Password was revoked or changed on WordPress, or
// publish rights were lost)? Only a 401 means broken. Every other failure
// (5xx, network, 404) is transient — never mark the connection broken on it.
export function isRevokedError(err: unknown): boolean {
  return err instanceof WordPressError && err.status === 401;
}

// What a successful credential check tells the connect route: the connected
// account's display name (for the card) and whether it may publish posts (the
// AC — credentials that cannot write posts are rejected).
export interface CredentialCheck {
  accountName: string | null;
  canPublishPosts: boolean;
}

export interface WordPressCredential {
  siteUrl: string;
  username: string;
  applicationPassword: string;
}

// The WordPress REST endpoint that returns the current user WITH their
// capabilities — context=edit is required for `capabilities` to be present.
const USERS_ME_PATH = "/wp-json/wp/v2/users/me?context=edit";

// Cap the validation request. The site URL is user-supplied, so a slow or hung
// host must not pin the connect request open until the platform's function
// max-duration kills it (a 504 + a tied-up concurrency slot). A timeout fires an
// AbortError — not a WordPressError — so isRevokedError() is false and the
// connect route maps it to a transient 502, never marking the connection broken.
const VALIDATE_TIMEOUT_MS = 10_000;

function basicAuth(username: string, applicationPassword: string): string {
  const token = Buffer.from(`${username}:${applicationPassword}`).toString("base64");
  return `Basic ${token}`;
}

// Turn a non-ok response into a WordPressError. WordPress returns
// { code, message } JSON on REST errors; fall back to http_<status> for a
// non-JSON body (e.g. a 5xx HTML page from a proxy) so a transient failure
// stays distinguishable from a 401.
async function toWordPressError(res: Response): Promise<WordPressError> {
  let code = `http_${res.status}`;
  let message = `WordPress endpoint returned ${res.status}`;
  try {
    const body = (await res.json()) as { code?: unknown; message?: unknown };
    if (typeof body.code === "string") code = body.code;
    if (typeof body.message === "string") message = body.message;
  } catch {
    // non-JSON body — keep the http_<status> code.
  }
  return new WordPressError(res.status, code, message);
}

// Validate a credential against the live WordPress site. Side-effect-free: a
// single GET of the current user in the edit context, never a create/delete of a
// probe post. Returns the account name + whether it can publish posts.
export async function validateCredential(
  cred: WordPressCredential,
  deps: { fetchImpl?: typeof fetch; signal?: AbortSignal } = {},
): Promise<CredentialCheck> {
  const fetchImpl = deps.fetchImpl ?? fetch;
  const res = await fetchImpl(`${cred.siteUrl}${USERS_ME_PATH}`, {
    method: "GET",
    headers: {
      Authorization: basicAuth(cred.username, cred.applicationPassword),
      Accept: "application/json",
    },
    signal: deps.signal ?? AbortSignal.timeout(VALIDATE_TIMEOUT_MS),
  });
  if (!res.ok) throw await toWordPressError(res);
  const body = (await res.json()) as {
    name?: unknown;
    capabilities?: Record<string, unknown> | null;
  };
  return {
    accountName: typeof body.name === "string" ? body.name : null,
    canPublishPosts: body.capabilities?.publish_posts === true,
  };
}

// ---------------------------------------------------------------------------
// #606 — the Showcase publisher.
//
// The deep module the publish route leans on: given a Showcase's rendered
// content it creates OR updates exactly one WordPress post in the Projects
// category and reports the remote id + URL. Editing a published Showcase passes
// the recorded post id back in, so the same post is re-pushed — never a
// duplicate. Auth + error contract is identical to validateCredential: a 401 is
// the only revoked signal (toWordPressError → isRevokedError true); every other
// failure (5xx, network, timeout) is transient and never breaks the connection.
// ---------------------------------------------------------------------------

const POSTS_PATH = "/wp-json/wp/v2/posts";
const CATEGORIES_PATH = "/wp-json/wp/v2/categories";
// The category every Showcase post lives under (ADR 0015 — "Projects"): the
// slug used to look it up, and the display name used to create it if absent.
const PROJECTS_SLUG = "projects";
const PROJECTS_NAME = "Projects";

// Cap the publish like the validation probe: a hung host must not pin the route
// open until the platform's function timeout fires. A timeout is an AbortError —
// not a WordPressError — so it is transient, never a broken connection.
const PUBLISH_TIMEOUT_MS = 20_000;

// The content the publisher posts. Pre-rendered: the title and the post body
// HTML (write-up + photo figures) are shaped by the pure renderer in
// showcase-post.ts, keeping this module a thin REST client.
export interface ShowcasePostContent {
  title: string;
  bodyHtml: string;
}

// What a publish records back on the Showcase: the remote post id (stored as
// text — provider-neutral) and the live URL the UI links to.
export interface PublishedPost {
  id: string;
  url: string;
}

// Resolve the WordPress category id for "Projects", looking it up by slug.
async function resolveProjectsCategoryId(
  cred: WordPressCredential,
  fetchImpl: typeof fetch,
  signal: AbortSignal,
): Promise<number> {
  const res = await fetchImpl(`${cred.siteUrl}${CATEGORIES_PATH}?slug=${PROJECTS_SLUG}`, {
    method: "GET",
    headers: {
      Authorization: basicAuth(cred.username, cred.applicationPassword),
      Accept: "application/json",
    },
    signal,
  });
  if (!res.ok) throw await toWordPressError(res);
  const list = (await res.json()) as Array<{ id?: unknown }>;
  const found = Array.isArray(list)
    ? list.find((c) => typeof c.id === "number")
    : undefined;
  if (found && typeof found.id === "number") return found.id;

  // No Projects category yet — create it once. A 401 here is still the revoked
  // signal (toWordPressError preserves the status); anything else is transient.
  const created = await fetchImpl(`${cred.siteUrl}${CATEGORIES_PATH}`, {
    method: "POST",
    headers: {
      Authorization: basicAuth(cred.username, cred.applicationPassword),
      "Content-Type": "application/json",
      Accept: "application/json",
    },
    body: JSON.stringify({ name: PROJECTS_NAME }),
    signal,
  });
  if (!created.ok) throw await toWordPressError(created);
  const category = (await created.json()) as { id?: unknown };
  if (typeof category.id !== "number") {
    throw new Error("WordPress returned no id for the created Projects category");
  }
  return category.id;
}

export async function publishShowcasePost(
  cred: WordPressCredential,
  content: ShowcasePostContent,
  existingPostId: string | null,
  deps: { fetchImpl?: typeof fetch; signal?: AbortSignal } = {},
): Promise<PublishedPost> {
  const fetchImpl = deps.fetchImpl ?? fetch;
  const signal = deps.signal ?? AbortSignal.timeout(PUBLISH_TIMEOUT_MS);

  const categoryId = await resolveProjectsCategoryId(cred, fetchImpl, signal);

  // existingPostId set → POST /posts/{id} re-pushes the SAME post (WordPress
  // updates via POST too); null → POST /posts creates a new one. This is the
  // single point that makes an edit an update, never a duplicate.
  const path = existingPostId ? `${POSTS_PATH}/${existingPostId}` : POSTS_PATH;
  const res = await fetchImpl(`${cred.siteUrl}${path}`, {
    method: "POST",
    headers: {
      Authorization: basicAuth(cred.username, cred.applicationPassword),
      "Content-Type": "application/json",
      Accept: "application/json",
    },
    body: JSON.stringify({
      title: content.title,
      content: content.bodyHtml,
      status: "publish",
      categories: [categoryId],
    }),
    signal,
  });
  if (!res.ok) throw await toWordPressError(res);
  const post = (await res.json()) as { id?: unknown; link?: unknown };
  return {
    id: String(post.id),
    url: typeof post.link === "string" ? post.link : "",
  };
}

// Normalise the site URL an admin pastes into a single canonical form, used both
// as the display value and as the base for every REST call. Adds https:// when
// no scheme is given, lower-cases the host (case-insensitive per the URL spec),
// preserves a subdirectory install's path, and drops the trailing slash so the
// REST path can be appended cleanly.
export function normalizeSiteUrl(raw: string): string {
  const trimmed = raw.trim();
  const withScheme = /^https?:\/\//i.test(trimmed) ? trimmed : `https://${trimmed}`;
  const url = new URL(withScheme);
  // URL lower-cases protocol + host for us; strip any trailing slash from the
  // path so `${base}/wp-json/...` never doubles up.
  const path = url.pathname.replace(/\/+$/, "");
  return `${url.protocol}//${url.host}${path}`;
}
