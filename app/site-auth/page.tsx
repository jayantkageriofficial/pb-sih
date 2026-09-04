"use client";
import { Suspense, useState } from "react";
import { useSearchParams } from "next/navigation";
import {
  SITE_AUTH_API_URL,
  SITE_AUTH_BASE_PATH,
  SITE_AUTH_LOGIN_URL,
} from "@/lib/siteAuth";

function SiteAuthForm() {
  const searchParams = useSearchParams();
  const next = searchParams.get("next") || SITE_AUTH_BASE_PATH;

  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [isLoading, setIsLoading] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsLoading(true);
    setError("");

    try {
      const res = await fetch(SITE_AUTH_API_URL, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ username, password }),
      });
      const data = await res.json();

      if (!res.ok || !data.success) {
        setError(data.error || "Incorrect username or password.");
        return;
      }

      // Full navigation (not router.push) so the cookie we just received
      // is present on the very next request and middleware lets us through.
      window.location.href =
        next === SITE_AUTH_LOGIN_URL || next.startsWith(`${SITE_AUTH_LOGIN_URL}?`)
          ? SITE_AUTH_BASE_PATH
          : next;
    } catch {
      setError("Something went wrong. Please try again.");
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <div className="min-h-screen bg-background flex items-center justify-center px-6">
      <div className="w-full max-w-sm">
        <div className="text-center mb-8">
          <h1 className="font-display text-3xl font-light mb-2 text-heading tracking-tight">
            Restricted Access
          </h1>
          <p className="text-gray-400 text-sm font-body">
            Enter the site credentials to continue
          </p>
        </div>

        <form
          onSubmit={handleSubmit}
          className="bg-gray-900/30 border border-gray-800 rounded-2xl p-8 space-y-5"
        >
          {error && (
            <div className="p-3 bg-red-900/20 border border-red-800 rounded-lg text-red-400 text-sm font-body">
              {error}
            </div>
          )}

          <div>
            <label className="block text-subheading text-sm font-medium mb-2 tracking-wide">
              Username
            </label>
            <input
              type="text"
              value={username}
              onChange={(e) => setUsername(e.target.value)}
              className="w-full px-4 py-3 bg-gray-800/50 border border-gray-700 rounded-lg text-white placeholder-gray-400 focus:border-heading focus:outline-none transition-colors duration-300 font-body"
              autoComplete="username"
              autoFocus
              required
            />
          </div>

          <div>
            <label className="block text-subheading text-sm font-medium mb-2 tracking-wide">
              Password
            </label>
            <input
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              className="w-full px-4 py-3 bg-gray-800/50 border border-gray-700 rounded-lg text-white placeholder-gray-400 focus:border-heading focus:outline-none transition-colors duration-300 font-body"
              autoComplete="current-password"
              required
            />
          </div>

          <button
            type="submit"
            disabled={isLoading}
            className={`w-full py-3 rounded-lg text-white font-medium tracking-wide font-body transition-all duration-300 ${
              isLoading
                ? "bg-gray-600 cursor-not-allowed"
                : "bg-heading hover:bg-heading/90"
            }`}
          >
            {isLoading ? "Checking..." : "Continue"}
          </button>
        </form>
      </div>
    </div>
  );
}

export default function SiteAuthPage() {
  return (
    <Suspense fallback={<div className="min-h-screen bg-background" />}>
      <SiteAuthForm />
    </Suspense>
  );
}
