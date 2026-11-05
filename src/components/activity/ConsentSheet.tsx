"use client";

import Link from "next/link";
import { useState } from "react";
import { Sheet } from "@/components/Sheet";
import { toast } from "@/components/ui/Toast";
import { activityErrorMessage, saveActivitySettings, type ActivitySettingsState } from "@/lib/activity";

/**
 * Uitdrukkelijke toestemming om activiteit (gezondheidsgegevens) op te slaan. Het vinkje staat
 * standaard uit; pas daarna kan de knop. De server legt vast wanneer en voor welke tekstversie
 * (ACTIVITY_CONSENT_VERSION) je toestemming gaf, en weigert onder de 16 jaar.
 */
export function ConsentSheet({
  open,
  onClose,
  userId,
  onConsented,
  reconsent = false,
}: {
  open: boolean;
  onClose: () => void;
  userId: string;
  /** Je gaf al toestemming, maar voor een oudere versie van deze tekst: opnieuw vragen (wist niets). */
  reconsent?: boolean;
  /** Na geslaagde toestemming (het paneel sluit zelf niet: dat doet de aanroeper, of hij opent iets anders). */
  onConsented?: (state: ActivitySettingsState) => void;
}) {
  const [agreed, setAgreed] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Elke keer opnieuw openen begint met een leeg vinkje.
  const [wasOpen, setWasOpen] = useState(open);
  if (open !== wasOpen) {
    setWasOpen(open);
    if (open) {
      setAgreed(false);
      setError(null);
    }
  }

  function close() {
    if (busy) return;
    onClose();
  }

  async function give() {
    setBusy(true);
    setError(null);
    try {
      const state = await saveActivitySettings(userId, { store: true });
      toast.success(reconsent ? "Bedankt, je toestemming is bijgewerkt" : "Activiteit bijhouden staat aan");
      if (onConsented) onConsented(state);
      else onClose();
    } catch (err) {
      setError(activityErrorMessage(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Sheet open={open} onClose={close} title={reconsent ? "Toestemming bijwerken" : "Activiteit bijhouden"}>
      <div className="space-y-4 text-sm">
        {reconsent ? (
          <p className="text-muted">
            De uitleg over wat we met je activiteit doen, is gewijzigd. Lees hem opnieuw en geef opnieuw toestemming. Je gegevens
            blijven gewoon staan.
          </p>
        ) : (
          <p className="text-muted">
            Houd je dagelijkse stappen bij, handmatig of later automatisch via de Android- of iPhone-app. Daarvoor vragen we eerst je
            toestemming.
          </p>
        )}

        <dl className="space-y-3 rounded-xl border border-line bg-surface-2/60 p-3">
          <div>
            <dt className="font-semibold">Wat we opslaan</dt>
            <dd className="text-muted">
              Per dag je totaal aantal stappen en actieve kcal, en waar ze vandaan komen (handmatig of de naam van de app). Geen
              locaties, hartslag of losse metingen.
            </dd>
          </div>
          <div>
            <dt className="font-semibold">Waarvoor</dt>
            <dd className="text-muted">
              Om je stappen en je voortgang naar je stappendoel te tonen. Delen met vrienden, gebruik door de AI-coach en
              calorieën terugverdienen zet je los aan; dat staat standaard uit.
            </dd>
          </div>
          <div>
            <dt className="font-semibold">Gezondheidsgegevens</dt>
            <dd className="text-muted">
              Stappen en verbrande calorieën gelden als gezondheidsgegevens. Daarom slaan we ze alleen op met jouw uitdrukkelijke
              toestemming.
            </dd>
          </div>
          <div>
            <dt className="font-semibold">Intrekken</dt>
            <dd className="text-muted">
              Dat kan altijd in Profiel, onder Koppelingen. Al je stappen- en caloriegegevens worden dan direct verwijderd.
            </dd>
          </div>
        </dl>

        <p className="text-muted">
          Meer hierover in de{" "}
          <Link href="/privacy" className="font-semibold text-accent underline-offset-2 hover:underline">
            privacyverklaring
          </Link>
          .
        </p>

        <label className="flex cursor-pointer items-start gap-3 rounded-xl border border-line p-3 transition hover:border-muted">
          <input
            type="checkbox"
            className="mt-0.5 h-5 w-5 shrink-0 accent-[var(--color-accent)]"
            checked={agreed}
            onChange={(e) => setAgreed(e.target.checked)}
            disabled={busy}
          />
          <span>
            Ik geef toestemming om mijn dagelijkse stappen en actieve kcal (gezondheidsgegevens) op te slaan voor de doeleinden
            hierboven.
          </span>
        </label>

        {error && (
          <p role="alert" className="rounded-xl border border-danger/30 bg-danger/10 px-3 py-2 text-danger">
            {error}
          </p>
        )}

        <div className="grid grid-cols-2 gap-2">
          <button type="button" className="btn-ghost" onClick={close} disabled={busy}>
            Niet nu
          </button>
          <button type="button" className="btn-primary" onClick={give} disabled={!agreed || busy} aria-busy={busy}>
            {busy ? "Bezig…" : "Ik geef toestemming"}
          </button>
        </div>
      </div>
    </Sheet>
  );
}
