"use client";

import { Suspense, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { createClient } from "@/lib/os/supabase/client";

export default function LoginPage() {
  return (
    <Suspense fallback={null}>
      <LoginForm />
    </Suspense>
  );
}

function LoginForm() {
  const router = useRouter();
  const params = useSearchParams();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [err, setErr] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setErr(null);
    setLoading(true);
    const supabase = createClient();
    const { error } = await supabase.auth.signInWithPassword({ email, password });
    setLoading(false);
    if (error) {
      setErr(error.message);
      return;
    }
    router.replace(params.get("next") || "/reps");
    router.refresh();
  }

  return (
    <div className="min-h-screen flex items-center justify-center px-4">
      <div className="card w-full max-w-sm p-7">
        <div className="flex items-center gap-2.5 mb-1">
          <div className="w-8 h-8 rounded-lg bg-navy text-white grid place-items-center font-bold text-sm">
            RNB
          </div>
          <div className="font-bold text-navy text-lg leading-tight">
            Onboarding
          </div>
        </div>
        <p className="text-muted text-[13px] mb-5">
          Rock N Block — sales rep onboarding tool
        </p>

        <form onSubmit={onSubmit} className="space-y-3">
          <div>
            <label className="block text-[12px] font-semibold text-muted mb-1">Email</label>
            <input
              className="input w-full"
              type="email"
              autoComplete="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              required
            />
          </div>
          <div>
            <label className="block text-[12px] font-semibold text-muted mb-1">Password</label>
            <input
              className="input w-full"
              type="password"
              autoComplete="current-password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              required
            />
          </div>
          {err && (
            <div className="text-[12px] text-red bg-red/10 border border-red/20 rounded-lg px-3 py-2">
              {err}
            </div>
          )}
          <button className="btn btn-primary w-full justify-center" disabled={loading}>
            {loading ? "Signing in…" : "Sign in"}
          </button>
        </form>
      </div>
    </div>
  );
}
