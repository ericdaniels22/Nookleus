const SCHEME = "nookleus://";

/**
 * In-app route for each Quick Actions widget deep-link action. The action
 * names are the URL "host" the widget emits (e.g. `nookleus://new-job`) and
 * must stay in sync with the URLs hard-coded in the WidgetKit extension.
 */
const ROUTES: Record<string, string> = {
  "new-job": "/intake",
  "add-photo": "/photos",
  "compose-email": "/email?compose=1",
  jarvis: "/jarvis",
};

/**
 * Maps a `nookleus://` deep-link URL (delivered by Capacitor's `appUrlOpen`
 * event) to the in-app route it should open. Returns `null` for any input
 * that is not a recognized `nookleus://` action so callers can ignore it.
 */
export function parseDeepLink(url: string): string | null {
  if (!url.startsWith(SCHEME)) return null;
  const rest = url.slice(SCHEME.length);
  const action = rest.split(/[/?#]/)[0];

  // The Emails widget (#174) emits `nookleus://email` with a query param
  // saying what to open, so its route is built dynamically.
  if (action === "email") {
    const params = new URLSearchParams(rest.split("?")[1] ?? "");
    const id = params.get("id");
    if (id) return `/email?id=${encodeURIComponent(id)}`;
    const account = params.get("account");
    if (account) return `/email?account=${encodeURIComponent(account)}`;
    return "/email";
  }

  return ROUTES[action] ?? null;
}
