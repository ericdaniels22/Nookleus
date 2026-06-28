import Link from "next/link";
import Image from "next/image";
import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Nookleus — Operations platform for service businesses",
  description:
    "Nookleus is the all-in-one operations platform for service businesses — manage jobs, estimates, invoices, scheduling, and marketing, including your Google Business Profile, in one place.",
};

// Public marketing home page. This is the "Application home page" Google shows
// on the OAuth consent screen and visits during app verification (#789), so it
// must load without a Nookleus session and clearly describe the app and how it
// uses connected Google data. Kept deliberately simple.
export default function WelcomePage() {
  return (
    <div className="mx-auto flex min-h-screen max-w-3xl flex-col px-6 py-10">
      <header className="flex items-center justify-between">
        <Image
          src="/nookleus-lockup.png"
          alt="Nookleus"
          width={200}
          height={136}
          priority
          className="h-10 w-auto"
        />
        <Link href="/login" className="public-button-secondary">
          Sign in
        </Link>
      </header>

      <main className="public-doc-body flex-1 py-12">
        <h1>The operations platform for service businesses</h1>
        <p className="public-muted" style={{ fontSize: 16 }}>
          Nookleus brings the day-to-day of running a service business into one
          place — intake, jobs, estimates, invoices, scheduling, payments, and
          marketing — so your team spends less time switching tools and more
          time on the work.
        </p>

        <h2>What you can do</h2>
        <ul>
          <li>Capture leads and turn them into scheduled, tracked jobs.</li>
          <li>Build estimates and invoices and collect payment online.</li>
          <li>Coordinate crews, photos, and job reports from the field.</li>
          <li>
            Run your marketing — including connecting your company&apos;s Google
            Business Profile to manage reviews, posts, and performance from
            inside Nookleus.
          </li>
        </ul>

        <h2>Connecting Google</h2>
        <p>
          An administrator can link your company&apos;s Google account once, from{" "}
          <strong>Settings → Connections</strong>. Nookleus requests only the
          access it needs to manage your Google Business Profile on your behalf,
          stores the connection encrypted, and lets you disconnect at any time.
          Our handling of Google user data is described in our{" "}
          <Link href="/privacy">Privacy Policy</Link>.
        </p>

        <hr />
        <p className="public-muted">
          Questions? Email{" "}
          <a href="mailto:eric@aaacontracting.com">eric@aaacontracting.com</a>.
        </p>
      </main>

      <footer
        className="public-doc-body public-muted flex flex-wrap items-center gap-x-4 gap-y-2 border-t pt-6"
        style={{ borderTopColor: "#e5e7eb" }}
      >
        <span>© Nookleus</span>
        <Link href="/privacy">Privacy Policy</Link>
        <Link href="/terms">Terms of Service</Link>
        <a href="mailto:eric@aaacontracting.com">Contact</a>
      </footer>
    </div>
  );
}
