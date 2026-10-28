"use client";

import Image from "next/image";
import { useRouter, useSearchParams } from "next/navigation";
import { Suspense, useEffect, useState } from "react";
import { useAuth } from "@/components/AuthProvider";
import { errorMessage, supabase } from "@/lib/supabase";

export default function LoginPage() {
  return (
    <Suspense>
      <LoginForm />
    </Suspense>
  );
}

function LoginForm() {
  const [mode, setMode] = useState<"login" | "signup">("login");
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [info, setInfo] = useState<string | null>(null);
  const { session } = useAuth();
  const router = useRouter();
  const next = useSearchParams().get("next") || "/";
  const safeNext = next.startsWith("/") && !next.startsWith("//") ? next : "/";

  useEffect(() => {
    if (session) router.replace(safeNext);
  }, [session, safeNext, router]);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    setInfo(null);
    try {
      if (mode === "login") {
        const { error } = await supabase.auth.signInWithPassword({ email, password });
        if (error) throw error;
      } else {
        const { data, error } = await supabase.auth.signUp({
          email,
          password,
          options: {
            data: { display_name: name.trim() },
            emailRedirectTo: `${window.location.origin}${safeNext}`,
          },
        });
        if (error) throw error;
        if (!data.session) {
          setInfo("Check je mail en klik op de bevestigingslink, daarna kun je inloggen.");
        }
      }
    } catch (err) {
      setError(translate(errorMessage(err)));
    } finally {
      setBusy(false);
    }
  }

  return (
    <main className="mx-auto flex min-h-dvh max-w-sm flex-col justify-center px-6 py-10">
      <div className="animate-fade-up mb-8 text-center">
        <Image src="/icon.svg" alt="" width={64} height={64} className="mx-auto mb-4" priority />
        <h1 className="text-3xl font-extrabold tracking-tight">GymApp</h1>
        <p className="mt-1 text-muted">Samen trainen, alles bijhouden.</p>
      </div>

      <div className="animate-fade-up mb-6 grid grid-cols-2 rounded-xl border border-line bg-surface p-1" style={{ "--i": 2 } as React.CSSProperties}>
        {(["login", "signup"] as const).map((m) => (
          <button
            key={m}
            onClick={() => setMode(m)}
            className={`rounded-lg py-2 text-sm font-semibold transition-colors duration-200 ${mode === m ? "bg-surface-2 text-ink" : "text-muted"}`}
          >
            {m === "login" ? "Inloggen" : "Account maken"}
          </button>
        ))}
      </div>

      <form onSubmit={submit} className="animate-fade-up space-y-4" style={{ "--i": 4 } as React.CSSProperties}>
        {mode === "signup" && (
          <div>
            <label className="label" htmlFor="name">Naam</label>
            <input id="name" className="input" value={name} onChange={(e) => setName(e.target.value)} required autoComplete="name" />
          </div>
        )}
        <div>
          <label className="label" htmlFor="email">E-mail</label>
          <input id="email" type="email" className="input" value={email} onChange={(e) => setEmail(e.target.value)} required autoComplete="email" />
        </div>
        <div>
          <label className="label" htmlFor="password">Wachtwoord</label>
          <input
            id="password"
            type="password"
            className="input"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            required
            minLength={6}
            autoComplete={mode === "login" ? "current-password" : "new-password"}
          />
        </div>
        {error && <p className="text-sm text-danger">{error}</p>}
        {info && <p className="text-sm text-accent">{info}</p>}
        <button className="btn-primary w-full py-3" disabled={busy}>
          {busy ? "Even geduld…" : mode === "login" ? "Inloggen" : "Account maken"}
        </button>
      </form>
    </main>
  );
}

function translate(msg: string): string {
  if (msg.includes("Invalid login credentials")) return "E-mail of wachtwoord klopt niet.";
  if (msg.includes("Email not confirmed")) return "Bevestig eerst je e-mail via de link in je inbox.";
  if (msg.includes("already registered")) return "Dit e-mailadres heeft al een account. Log in.";
  if (msg.includes("Password should be")) return "Wachtwoord moet minimaal 6 tekens zijn.";
  return msg;
}
