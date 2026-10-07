"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Logo } from "@/components/logo";
import { signInAsViewer } from "@/lib/viewer-auth";
import { createClient } from "@/lib/supabase/client";

type LoginFormProps = {
  viewerLoginEnabled: boolean;
};

export function LoginForm({ viewerLoginEnabled }: LoginFormProps) {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [viewerLoading, setViewerLoading] = useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    setError(null);

    const supabase = createClient();
    const { error: authError } = await supabase.auth.signInWithPassword({
      email,
      password,
    });

    if (authError) {
      setError(authError.message);
      setLoading(false);
      return;
    }

    // eslint-disable-next-line @next/next/no-location-assign-relative-destination -- session cookies
    window.location.assign("/");
  }

  async function handleViewerSignIn() {
    setViewerLoading(true);
    setError(null);
    const result = await signInAsViewer();
    if (!result.ok) {
      setError(result.error);
      setViewerLoading(false);
      return;
    }
    // eslint-disable-next-line @next/next/no-location-assign-relative-destination -- session cookies
    window.location.assign("/");
  }

  return (
    <div className="flex min-h-screen items-center justify-center px-4">
      <div className="w-full max-w-md rounded-xl border border-zinc-800 bg-zinc-900 p-8">
        <Logo size="lg" />
        <p className="mt-3 text-sm text-zinc-400">Sign in to your trading dashboard</p>

        <form onSubmit={handleSubmit} className="mt-8 space-y-4">
          <div>
            <Label htmlFor="email">Email</Label>
            <Input
              id="email"
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              required
              autoComplete="email"
            />
          </div>
          <div>
            <Label htmlFor="password">Password</Label>
            <Input
              id="password"
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              required
              autoComplete="current-password"
            />
          </div>
          {error && <p className="text-sm text-red-400">{error}</p>}
          <Button type="submit" className="w-full" disabled={loading || viewerLoading}>
            {loading ? "Signing in…" : "Sign in"}
          </Button>
        </form>

        {viewerLoginEnabled ? (
          <div className="mt-6 border-t border-zinc-800 pt-6 text-center">
            <p className="text-xs text-zinc-500">Just browsing?</p>
            <Button
              type="button"
              className="mt-2 w-full bg-transparent text-zinc-400 hover:bg-zinc-800 hover:text-zinc-200"
              disabled={loading || viewerLoading}
              onClick={handleViewerSignIn}
            >
              {viewerLoading ? "Opening read-only view…" : "View read-only"}
            </Button>
          </div>
        ) : null}
      </div>
    </div>
  );
}
