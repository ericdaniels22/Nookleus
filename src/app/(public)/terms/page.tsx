import Link from "next/link";
import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Terms of Service",
  description: "The terms that govern use of the Nookleus platform.",
};

// Public terms of service. Linked from the OAuth consent screen branding and
// the marketing home page (#789). Legal content is a starting scaffold; a
// formal counsel review is deferred (tracked in #790).
//
// Operating entity is AAA Disaster Recovery on an interim basis — Nookleus has
// no separate LLC yet. Transitioning to a standalone Nookleus entity is tracked
// in #790.
export default function TermsOfServicePage() {
  return (
    <div className="public-doc-body mx-auto max-w-3xl px-6 py-10">
      <h1>Terms of Service</h1>
      <p className="public-muted">Last updated: June 28, 2026</p>

      <h2>1. Acceptance of these terms</h2>
      <p>
        These Terms of Service (&ldquo;Terms&rdquo;) govern your access to and use
        of the Nookleus operations platform (the &ldquo;Service&rdquo;) provided
        by AAA Disaster Recovery (&ldquo;Nookleus,&rdquo; &ldquo;we,&rdquo;
        &ldquo;us&rdquo;). By accessing or using the Service, you agree to these
        Terms. If you are using the Service on behalf of an organization, you
        agree on its behalf.
      </p>

      <h2>2. The Service</h2>
      <p>
        Nookleus provides tools for service businesses to manage intake, jobs,
        estimates, invoices, scheduling, payments, and marketing. We may update,
        add, or remove features over time.
      </p>

      <h2>3. Accounts and responsibilities</h2>
      <p>
        You are responsible for maintaining the confidentiality of your account
        credentials and for all activity under your account. You agree to provide
        accurate information and to keep it up to date.
      </p>

      <h2>4. Acceptable use</h2>
      <p>
        You agree not to misuse the Service, including by attempting to access it
        in an unauthorized way, interfering with its operation, or using it to
        violate any law or the rights of others.
      </p>

      <h2>5. Your data</h2>
      <p>
        You retain ownership of the data you put into the Service. You grant us
        the limited rights needed to host and process that data to provide the
        Service. Our handling of personal information is described in our{" "}
        <Link href="/privacy">Privacy Policy</Link>.
      </p>

      <h2>6. Third-party services</h2>
      <p>
        The Service can connect to third-party providers (such as Google, for
        Business Profile management, and payment processors). Your use of those
        connections is also subject to the third party&apos;s terms, and we are
        not responsible for third-party services.
      </p>

      <h2>7. Disclaimers</h2>
      <p>
        The Service is provided &ldquo;as is&rdquo; without warranties of any
        kind, to the fullest extent permitted by law.
      </p>

      <h2>8. Limitation of liability</h2>
      <p>
        To the fullest extent permitted by law, Nookleus will not be liable for
        any indirect, incidental, or consequential damages arising out of your
        use of the Service.
      </p>

      <h2>9. Termination</h2>
      <p>
        You may stop using the Service at any time. We may suspend or terminate
        access if these Terms are violated or as needed to protect the Service.
      </p>

      <h2>10. Changes to these Terms</h2>
      <p>
        We may revise these Terms from time to time. Material changes will be
        reflected by updating the &ldquo;Last updated&rdquo; date above.
      </p>

      <h2>11. Governing law</h2>
      <p>
        These Terms are governed by the laws of the State of Texas, without
        regard to its conflict-of-law principles.
      </p>

      <h2>12. Contact</h2>
      <p>
        Questions about these Terms? Email{" "}
        <a href="mailto:eric@aaacontracting.com">eric@aaacontracting.com</a>.
      </p>

      <hr />
      <p className="public-muted">
        <Link href="/welcome">Home</Link> ·{" "}
        <Link href="/privacy">Privacy Policy</Link>
      </p>
    </div>
  );
}
