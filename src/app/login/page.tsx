"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase";
import { Input } from "@/components/ui/input";
import { Loader2 } from "lucide-react";
import Image from "next/image";

export default function LoginPage() {
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError("");
    setLoading(true);

    const supabase = createClient();
    const { error: authError } = await supabase.auth.signInWithPassword({
      email,
      password,
    });

    if (authError) {
      setError(authError.message === "Invalid login credentials"
        ? "Invalid email or password"
        : authError.message
      );
      setLoading(false);
      return;
    }

    router.push("/");
    router.refresh();
  }

  return (
    <div className="min-h-screen gradient-sidebar flex items-center justify-center p-4">
      <div className="w-full max-w-sm">
        {/* Logo */}
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

        {/* Login card — force light mode for readability */}
        <div className="bg-card rounded-2xl p-8 shadow-2xl ring-1 ring-white/10">
          <h1 className="text-xl font-bold text-foreground text-center mb-1">
            Sign In
          </h1>
          <p className="text-sm text-muted-foreground text-center mb-6">
            Sign in to Nookleus
          </p>

          <form onSubmit={handleSubmit} className="space-y-4">
            <div>
              <label className="block text-xs font-medium text-muted-foreground mb-1">
                Email
              </label>
              <Input
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="eric@aaadisasterrecovery.com"
                required
                autoFocus
              />
            </div>

            <div>
              <label className="block text-xs font-medium text-muted-foreground mb-1">
                Password
              </label>
              <Input
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="Enter your password"
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
              {loading ? "Signing in..." : "Sign In"}
            </button>
          </form>
        </div>

        <p className="text-center text-xs text-white/30 mt-6">
          Nookleus
        </p>
      </div>
    </div>
  );
}
