import Link from "next/link";
import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Privacy Policy",
  description:
    "How Nookleus collects, uses, stores, and shares information — including data accessed through Google APIs.",
};

// Public privacy policy. Required for Google OAuth app verification (#789):
// must be reachable without a session, hosted on the authorized domain, and
// disclose how the app accesses, uses, stores, shares, and lets users delete
// Google user data — including the verbatim Limited Use statement.
//
// Legal content is a starting scaffold; a formal counsel review is deferred
// (tracked in #790). All placeholders are filled with the interim operating
// entity, AAA Disaster Recovery — Nookleus has no separate LLC yet.
// Transitioning everything to a standalone Nookleus entity is tracked in #790.
export default function PrivacyPolicyPage() {
  return (
    <div className="public-doc-body mx-auto max-w-3xl px-6 py-10">
      <h1>Privacy Policy</h1>
      <p className="public-muted">Last updated: June 28, 2026</p>

      <p>
        This Privacy Policy explains how AAA Disaster Recovery (&ldquo;Nookleus,&rdquo;
        &ldquo;we,&rdquo; &ldquo;us&rdquo;) collects, uses, stores, and shares
        information in connection with the Nookleus operations platform (the
        &ldquo;Service&rdquo;). By using the Service you agree to this Policy.
      </p>

      <h2>Information we collect</h2>
      <ul>
        <li>
          <strong>Account information</strong> — name, email, phone, and the
          organization you belong to, used to sign you in and operate your
          workspace.
        </li>
        <li>
          <strong>Business data you enter</strong> — the customers, jobs,
          estimates, invoices, photos, and related records you and your team
          create in the Service.
        </li>
        <li>
          <strong>Information from connected accounts</strong> — when an
          administrator links a third-party account (such as Google), we receive
          data from that provider as described below.
        </li>
        <li>
          <strong>Usage and device information</strong> — basic logs needed to
          run, secure, and troubleshoot the Service.
        </li>
      </ul>

      <h2>Google user data</h2>
      <p>
        If an administrator connects your company&apos;s Google account, Nookleus
        requests the following Google OAuth scopes:
      </p>
      <ul>
        <li>
          <strong>Email and basic profile</strong> (<code>openid</code>,{" "}
          <code>userinfo.email</code>, <code>userinfo.profile</code>) — to
          identify the connected Google account and show which account is linked.
        </li>
        <li>
          <strong>Business Profile management</strong> (
          <code>business.manage</code>) — to read and manage your Google Business
          Profile listings, reviews, posts, and performance from within
          Nookleus, at your direction.
        </li>
      </ul>
      <p>
        We access this data only to provide the features you use inside Nookleus.
        We do not use Google user data for advertising, and we do not sell it.
      </p>

      <h3>Limited Use disclosure</h3>
      <p>
        Nookleus&apos;s use and transfer to any other app of information received
        from Google APIs will adhere to the{" "}
        <a
          href="https://developers.google.com/terms/api-services-user-data-policy"
          target="_blank"
          rel="noreferrer"
        >
          Google API Services User Data Policy
        </a>
        , including the Limited Use requirements.
      </p>

      <h2>How we store and protect information</h2>
      <p>
        Connection credentials, including Google refresh tokens, are encrypted at
        rest. Access to your workspace data is restricted to your organization
        and protected by authentication and role-based access controls. We retain
        information for as long as your account is active or as needed to provide
        the Service.
      </p>

      <h2>How we share information</h2>
      <p>
        We do not sell your information. We share it only with service providers
        that help us operate the Service (such as our hosting and database
        providers), when you direct us to (for example, sending an invoice), or
        when required by law.
      </p>

      <h2>Your choices and data deletion</h2>
      <ul>
        <li>
          <strong>Disconnect Google</strong> — an administrator can remove the
          Google connection at any time from <strong>Settings → Connections</strong>.
          Disconnecting deletes the stored Google credentials from our systems.
        </li>
        <li>
          <strong>Access and deletion</strong> — you may request access to, or
          deletion of, your information by contacting us at the address below.
        </li>
      </ul>

      <h2>Changes to this Policy</h2>
      <p>
        We may update this Policy from time to time. Material changes will be
        reflected by updating the &ldquo;Last updated&rdquo; date above.
      </p>

      <h2>Contact us</h2>
      <p>
        AAA Disaster Recovery
        <br />
        3310 W Braker Ln STE 300-122
        <br />
        Austin, TX 78758
        <br />
        Email: <a href="mailto:eric@aaacontracting.com">eric@aaacontracting.com</a>
      </p>

      <hr />
      <p className="public-muted">
        <Link href="/welcome">Home</Link> · <Link href="/terms">Terms of Service</Link>
      </p>
    </div>
  );
}
