"use client";

import { useState } from "react";
import { supabase } from "@/lib/supabase";
import { authErrorMessage } from "./authErrors";
import { PasswordInput } from "./PasswordInput";

export const MIN_PASSWORD = 6;

/** Simpele indicatie: lengte en variatie. Geen harde eis, wel een duwtje richting sterk. */
export function passwordStrength(pw: string): { score: 0 | 1 | 2 | 3; label: string } {
  if (pw.length < MIN_PASSWORD) return { score: 0, label: `Minimaal ${MIN_PASSWORD} tekens` };
  const kinds = [/[a-z]/, /[A-Z]/, /\d/, /[^A-Za-z0-9]/].filter((r) => r.test(pw)).length;
  if (pw.length >= 12 && kinds >= 2) return { score: 3, label: "Sterk" };
  if (pw.length >= 8 && kinds >= 2) return { score: 2, label: "Redelijk" };
  return { score: 1, label: "Zwak, maak hem langer" };
}

export function StrengthMeter({ password }: { password: string }) {
  if (!password) return null;
  const { score, label } = passwordStrength(password);
  const color = score >= 3 ? "bg-accent" : score === 2 ? "bg-warn" : "bg-danger";
  return (
    <div className="mt-2 flex items-center gap-2" aria-live="polite">
      <div className="flex flex-1 gap-1" aria-hidden>
        {[1, 2, 3].map((i) => (
          <span
            key={i}
            className={`h-1 flex-1 rounded-full transition-colors duration-200 ${score >= i ? color : "bg-surface-2"}`}
          />
        ))}
      </div>
      <span className="w-36 text-right text-xs text-muted">{label}</span>
    </div>
  );
}

/**
 * Nieuw wachtwoord instellen voor de ingelogde gebruiker. Gebruikt na de herstellink uit de mail
 * en (via het profiel) om je wachtwoord te wijzigen.
 */
export function NewPasswordForm({
  onDone,
  submitLabel = "Wachtwoord opslaan",
  autoFocus = false,
}: {
  onDone: () => void;
  submitLabel?: string;
  autoFocus?: boolean;
}) {
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const mismatch = confirm.length > 0 && confirm !== password;

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    if (password.length < MIN_PASSWORD) return setError(`Je wachtwoord moet minimaal ${MIN_PASSWORD} tekens zijn.`);
    if (password !== confirm) return setError("De twee wachtwoorden zijn niet gelijk.");
    setBusy(true);
    try {
      const { error } = await supabase.auth.updateUser({ password });
      if (error) throw error;
      onDone();
    } catch (err) {
      setError(authErrorMessage(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <form onSubmit={submit} className="space-y-4" noValidate>
      <div>
        <label className="label" htmlFor="new-password">
          Nieuw wachtwoord
        </label>
        <PasswordInput
          id="new-password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          autoComplete="new-password"
          autoFocus={autoFocus}
          minLength={MIN_PASSWORD}
          required
        />
        <StrengthMeter password={password} />
      </div>
      <div>
        <label className="label" htmlFor="confirm-password">
          Herhaal wachtwoord
        </label>
        <PasswordInput
          id="confirm-password"
          value={confirm}
          onChange={(e) => setConfirm(e.target.value)}
          autoComplete="new-password"
          aria-invalid={mismatch || undefined}
          aria-describedby={mismatch ? "confirm-hint" : undefined}
          required
        />
        {mismatch && (
          <p id="confirm-hint" className="mt-1.5 text-xs text-danger">
            Komt nog niet overeen.
          </p>
        )}
      </div>
      <div aria-live="polite">
        {error && (
          <p role="alert" className="animate-fade-in rounded-xl border border-danger/30 bg-danger/10 px-3 py-2 text-sm text-danger">
            {error}
          </p>
        )}
      </div>
      <button className="btn-primary w-full py-3" disabled={busy}>
        {busy && <span className="spinner" aria-hidden />}
        {busy ? "Opslaan…" : submitLabel}
      </button>
    </form>
  );
}
