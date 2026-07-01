"use client";

import { useEffect } from "react";
import { createClient } from "@/lib/supabase";
import { useRouter } from "next/navigation";

export default function LogoutPage() {
  const router = useRouter();

  useEffect(() => {
    const supabase = createClient();
    supabase.auth.signOut().then(() => {
      router.push("/login");
    });
  }, [router]);

  return (
    <div className="min-h-dvh flex items-center justify-center">
      <p className="text-muted-foreground">Signing out...</p>
    </div>
  );
}
