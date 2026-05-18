"use client";

import { Suspense, useEffect, useRef, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { createClient } from "@/lib/supabase";
import { Input } from "@/components/ui/input";
import { Loader2 } from "lucide-react";
import Image from "next/image";

// Landing page for the password recovery link from
// /api/settings/users/[id]/reset-password. The link carries a recovery
// token as ?token_hash=...; we verify it with verifyOtp to establish a
// session, then the user picks a password.
//
// This route is public — it must be in the proxy.ts allowlist and app-shell
// AUTH_ROUTES, since the user is not signed in when they arrive.
function SetPasswordForm() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const supabaseRef = useRef<ReturnType<typeof createClient> | null>(null);
  if (!supabaseRef.current) supabaseRef.current = createClient();
  const supabase = supabaseRef.current;

  // checking → resolving the recovery token; ready → show the form.
  const [checking, setChecking] = useState(true);
  const [ready, setReady] = useState(false);
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    const tokenHash = searchParams.get("token_hash");

    async function init() {
      if (tokenHash) {
        // Verify the recovery token from the link — establishes a session.
        const { error: verifyErr } = await supabase.auth.verifyOtp({
          type: "recovery",
          token_hash: tokenHash,
        });
        setReady(!verifyErr);
        setChecking(false);
        return;
      }
      // Fallback: a recovery session already present in the URL hash.
      const { data } = await supabase.auth.getSession();
      if (data.session) setReady(true);
      setChecking(false);
    }

    init();
  }, [supabase, searchParams]);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError("");
    if (password.length < 8) {
      setError("Password must be at least 8 characters.");
      return;
    }
    if (password !== confirm) {
      setError("Passwords don't match.");
      return;
    }
    setLoading(true);
    const { error: updErr } = await supabase.auth.updateUser({ password });
    if (updErr) {
      setError(updErr.message);
      setLoading(false);
      return;
    }
    router.push("/");
    router.refresh();
  }

  return (
    <div className="min-h-screen gradient-sidebar flex items-center justify-center p-4">
      <div className="w-full max-w-sm">
        <div className="flex justify-center mb-8">
          <Image
            src="/nookleus-lockup.png"
            alt="Nookleus"
            width={200}
            height={136}
            priority
            className="h-16 w-auto"
          />
        </div>

        <div className="bg-card rounded-2xl p-8 shadow-2xl ring-1 ring-white/10">
          {checking ? (
            <div className="flex items-center justify-center gap-2 py-6 text-sm text-muted-foreground">
              <Loader2 size={16} className="animate-spin" />
              Verifying your link...
            </div>
          ) : !ready ? (
            <div className="text-center">
              <h1 className="text-xl font-bold text-foreground mb-1">
                Link expired
              </h1>
              <p className="text-sm text-muted-foreground mb-6">
                This password link is invalid or has expired. Ask an admin to
                send you a new one.
              </p>
              <a
                href="/login"
                className="inline-flex items-center justify-center px-4 py-2 rounded-lg text-sm font-medium border border-border bg-card text-muted-foreground hover:bg-accent transition-colors"
              >
                Back to Sign In
              </a>
            </div>
          ) : (
            <>
              <h1 className="text-xl font-bold text-foreground text-center mb-1">
                Set Your Password
              </h1>
              <p className="text-sm text-muted-foreground text-center mb-6">
                Choose a password to finish setting up your account.
              </p>

              <form onSubmit={handleSubmit} className="space-y-4">
                <div>
                  <label className="block text-xs font-medium text-muted-foreground mb-1">
                    New Password
                  </label>
                  <Input
                    type="password"
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    placeholder="At least 8 characters"
                    required
                    autoFocus
                  />
                </div>

                <div>
                  <label className="block text-xs font-medium text-muted-foreground mb-1">
                    Confirm Password
                  </label>
                  <Input
                    type="password"
                    value={confirm}
                    onChange={(e) => setConfirm(e.target.value)}
                    placeholder="Re-enter your password"
                    required
                  />
                </div>

                {error && (
                  <p className="text-sm text-destructive bg-destructive/10 px-3 py-2 rounded-lg">
                    {error}
                  </p>
                )}

                <button
                  type="submit"
                  disabled={loading}
                  className="w-full flex items-center justify-center gap-2 px-4 py-2.5 rounded-lg text-sm font-medium bg-[image:var(--gradient-primary)] text-white shadow-sm hover:brightness-110 hover:shadow-md disabled:opacity-50 transition-all"
                >
                  {loading && <Loader2 size={16} className="animate-spin" />}
                  {loading ? "Saving..." : "Set Password & Continue"}
                </button>
              </form>
            </>
          )}
        </div>

        <p className="text-center text-xs text-white/30 mt-6">Nookleus</p>
      </div>
    </div>
  );
}

export default function SetPasswordPage() {
  // useSearchParams requires a Suspense boundary in the App Router.
  return (
    <Suspense fallback={null}>
      <SetPasswordForm />
    </Suspense>
  );
}
