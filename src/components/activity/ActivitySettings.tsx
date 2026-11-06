"use client";

import Link from "next/link";
import { useEffect, useId, useRef, useState } from "react";
import { ActivityEntrySheet } from "@/components/activity/ActivityEntrySheet";
import { ConsentSheet } from "@/components/activity/ConsentSheet";
import { HealthConnectPanel } from "@/components/activity/HealthConnectPanel";
import { StepsIcon } from "@/components/activity/icons";
import { useAuth } from "@/components/AuthProvider";
import { ChevronRightIcon, InfoIcon, LockIcon } from "@/components/Icons";
import { LoadError } from "@/components/platform/LoadError";
import { ConfirmSheet } from "@/components/social/ConfirmSheet";
import { PhoneIcon, TrashIcon } from "@/components/social/icons";
import { saveSleepSettings, sleepCoachAvailable, sleepCoachOn } from "@/components/sleep/settings";
import { SleepSettingsSection } from "@/components/sleep/SleepSettingsSection";
import { toast } from "@/components/ui/Toast";
import {
  ACTIVITY_LIMITS,
  activityErrorMessage,
  deleteAllActivity,
  saveActivitySettings,
  useActivitySettings,
  type ActivitySettingsPatch,
} from "@/lib/activity";
import { disconnectHealth, healthSyncInFlight, useHealthLink } from "@/lib/native/health";

/** Na zo lang stilstaan wordt een gewijzigd stappendoel opgeslagen. */
const GOAL_SAVE_DELAY = 700;

const fmtSteps = (n: number) => n.toLocaleString("nl-NL");

/**
 * Profiel → "Koppelingen en activiteit": toestemming voor gezondheidsgegevens (AVG), delen,
 * AI-coach, stappendoel, Health Connect (in de Android-app echt verbinden en synchroniseren, op het
 * web uitleg) en Apple Health, handmatig invoeren en alles
 * verwijderen. Zonder upgrade-activity.sql een rustige "nog niet ingeschakeld"-melding.
 */
export function ActivitySettings() {
  const { session } = useAuth();
  const userId = session?.user.id ?? null;
  const st = useActivitySettings(userId);
  const s = st.data;

  const [consentOpen, setConsentOpen] = useState(false);
  const [withdrawOpen, setWithdrawOpen] = useState(false);
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [entryOpen, setEntryOpen] = useState(false);
  const [busy, setBusy] = useState<keyof ActivitySettingsPatch | "coachSleep" | null>(null);
  const [goalDraft, setGoalDraft] = useState<number | null>(null);
  const goalTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const goalPending = useRef<number | null>(null);
  /** Wat er moet gebeuren zodra de toestemming gegeven is (bijv. verder met Health Connect verbinden). */
  const afterConsent = useRef<(() => void) | null>(null);
  const healthLink = useHealthLink(userId);
  const ids = useId();

  // Een nog niet opgeslagen stappendoel alsnog opslaan bij weggaan van de pagina.
  useEffect(() => {
    return () => {
      if (goalTimer.current) clearTimeout(goalTimer.current);
      const next = goalPending.current;
      if (next != null && userId) saveActivitySettings(userId, { stepGoal: next }).catch(() => {});
    };
  }, [userId]);

  async function patch(p: ActivitySettingsPatch, key: keyof ActivitySettingsPatch, success?: string) {
    if (!userId || busy) return;
    setBusy(key);
    try {
      await saveActivitySettings(userId, p);
      if (success) toast.success(success);
    } catch (err) {
      toast.error(activityErrorMessage(err));
    } finally {
      setBusy(null);
    }
  }

  function changeGoal(delta: number) {
    if (!s || !userId) return;
    const { min, max } = ACTIVITY_LIMITS.stepGoal;
    const next = Math.min(max, Math.max(min, (goalDraft ?? s.step_goal) + delta));
    setGoalDraft(next);
    goalPending.current = next;
    if (goalTimer.current) clearTimeout(goalTimer.current);
    goalTimer.current = setTimeout(async () => {
      goalTimer.current = null;
      const value = goalPending.current;
      goalPending.current = null;
      if (value == null) return;
      try {
        await saveActivitySettings(userId, { stepGoal: value });
      } catch (err) {
        toast.error(activityErrorMessage(err));
      } finally {
        // Alleen loslaten als er intussen niet opnieuw is getikt.
        if (goalPending.current == null) setGoalDraft(null);
      }
    }, GOAL_SAVE_DELAY);
  }

  async function toggleCoachSleep(next: boolean) {
    if (!userId || busy) return;
    setBusy("coachSleep");
    try {
      await saveSleepSettings(userId, { coachSleep: next });
      toast.success(next ? "De AI-coach kan nu ook je slaap gebruiken" : "De AI-coach gebruikt je slaap niet meer");
    } catch (err) {
      toast.error(activityErrorMessage(err));
    } finally {
      setBusy(null);
    }
  }

  /** Health Connect op dit toestel ontkoppelen en een lopende sync laten aflopen, zodat die niets terugzet. */
  async function stopHealthSync(uid: string) {
    disconnectHealth(uid);
    await healthSyncInFlight()?.catch(() => {});
  }

  async function withdraw() {
    if (!userId) return;
    // Geen toestemming meer: ook de Health Connect-koppeling op dit toestel vergeten.
    await stopHealthSync(userId);
    await saveActivitySettings(userId, { store: false });
    setWithdrawOpen(false);
    toast.success("Activiteit bijhouden staat uit. Je gegevens zijn verwijderd.");
  }

  async function removeAll() {
    if (!userId) return;
    // Anders haalt de volgende automatische sync de laatste dagen meteen weer op uit Health Connect.
    const wasLinked = healthLink.connected;
    await stopHealthSync(userId);
    await deleteAllActivity(userId);
    setDeleteOpen(false);
    toast.success(wasLinked ? "Al je activiteitsgegevens zijn verwijderd en Health Connect is ontkoppeld" : "Al je activiteitsgegevens zijn verwijderd");
  }

  function requestConsent(then?: () => void) {
    afterConsent.current = then ?? null;
    setConsentOpen(true);
  }

  const header = (
    <h2 id={`${ids}-h`} className="text-sm font-semibold uppercase tracking-wide text-muted">
      Koppelingen en activiteit
    </h2>
  );

  if (!userId) return null;

  if (!s) {
    return (
      <section id="koppelingen" className="scroll-mt-20 space-y-3" aria-labelledby={`${ids}-h`}>
        {header}
        {st.error ? (
          <LoadError error={st.error} onRetry={st.retry} retrying={st.refreshing} title="Koppelingen konden niet worden geladen" />
        ) : (
          <div className="card space-y-3" aria-busy>
            <div className="skeleton h-12" />
            <div className="skeleton h-12" />
            <div className="skeleton h-12" />
          </div>
        )}
      </section>
    );
  }

  if (!s.available) {
    return (
      <section id="koppelingen" className="scroll-mt-20 space-y-3" aria-labelledby={`${ids}-h`}>
        {header}
        <div className="card flex items-start gap-3 text-sm">
          <StepsIcon size={20} className="mt-0.5 shrink-0 text-muted" />
          <div className="space-y-1">
            <p className="font-semibold">Activiteit bijhouden is nog niet ingeschakeld</p>
            <p className="text-xs text-muted">
              Stappen, actieve kcal en slaap bijhouden, stappen delen met vrienden en koppelen met Health Connect of Apple Health
              komen hier zodra het is ingeschakeld.
            </p>
          </div>
        </div>
      </section>
    );
  }

  const consented = s.consented;
  const goal = goalDraft ?? s.step_goal;
  const { min, max, step } = ACTIVITY_LIMITS.stepGoal;

  return (
    <section id="koppelingen" className="scroll-mt-20 space-y-3" aria-labelledby={`${ids}-h`}>
      {header}

      {s.needsReconsent && (
        <div className="card flex items-start gap-3 border-accent/40 text-sm" role="status">
          <InfoIcon size={18} className="mt-0.5 shrink-0 text-accent" />
          <div className="min-w-0 flex-1 space-y-2">
            <p>
              <span className="font-semibold">De uitleg over je activiteitsgegevens is gewijzigd.</span>{" "}
              <span className="text-muted">Lees hem opnieuw en geef opnieuw toestemming. Je gegevens blijven staan.</span>
            </p>
            <button type="button" className="btn-primary min-h-11 px-4 text-xs" onClick={() => requestConsent()}>
              Bekijken
            </button>
          </div>
        </div>
      )}

      {/* Toestemming en voorkeuren */}
      <div className="card space-y-1">
        <ul className="divide-y divide-line">
          <SwitchRow
            id={`${ids}-store`}
            label="Activiteit bijhouden"
            description={
              consented
                ? "Je dagelijkse stappen, actieve kcal en slaap worden opgeslagen. Uitzetten verwijdert direct al deze gegevens."
                : "Sla per dag je stappen en actieve kcal en per nacht je slaap op. Hiervoor vragen we eerst je toestemming."
            }
            on={consented}
            busy={busy === "store"}
            disabled={busy !== null}
            onToggle={() => (consented ? setWithdrawOpen(true) : requestConsent())}
          />
          <SwitchRow
            id={`${ids}-share`}
            label="Delen met vrienden en groepsgenoten"
            description={
              <>
                Je vrienden en groepsgenoten die zelf ook delen, zien dan je stappen per dag (niet je kcal en nooit je slaap). In een groep is
                dat ook je trainer. Op de ranglijst staan alleen stappen. Staat standaard uit.
              </>
            }
            on={s.share_activity}
            busy={busy === "share"}
            disabled={!consented || busy !== null}
            onToggle={() =>
              patch(
                { share: !s.share_activity },
                "share",
                s.share_activity ? "Je deelt je activiteit niet meer" : "Je deelt je stappen nu met vrienden en groepsgenoten",
              )
            }
          />
          <SwitchRow
            id={`${ids}-coach`}
            label="Gebruiken door de AI-coach"
            description="Je stappen en actieve kcal worden dan naar Anthropic (Claude) gestuurd om je vragen te beantwoorden. Staat standaard uit."
            on={s.coach_activity}
            busy={busy === "coach"}
            disabled={!consented || busy !== null}
            onToggle={() => patch({ coach: !s.coach_activity }, "coach")}
          />
          {sleepCoachAvailable(s) && (
            <SwitchRow
              id={`${ids}-coach-sleep`}
              label="Ook je slaap gebruiken door de AI-coach"
              description={
                s.needsReconsent
                  ? "Geef eerst opnieuw toestemming (hierboven) om je slaap bij te houden."
                  : "Je slaap per nacht gaat dan ook naar Anthropic (Claude), bijvoorbeeld voor vragen over herstel. Een aparte keuze; staat standaard uit."
              }
              on={sleepCoachOn(s)}
              busy={busy === "coachSleep"}
              disabled={!consented || s.needsReconsent || !s.coach_activity || busy !== null}
              onToggle={() => toggleCoachSleep(!sleepCoachOn(s))}
            />
          )}
        </ul>
        {!consented && (
          <p className="flex items-center gap-1.5 pt-1 text-xs text-muted">
            <LockIcon size={12} className="shrink-0" /> Delen en de AI-coach kunnen pas aan als activiteit bijhouden aanstaat.
          </p>
        )}
      </div>

      {consented && (
        <div className="card animate-fade-up divide-y divide-line p-0">
          {/* Stappendoel */}
          <div className="flex items-center justify-between gap-3 px-4 py-3">
            <div className="min-w-0">
              <p id={`${ids}-goal`} className="text-sm font-medium">
                Stappendoel
              </p>
              <p className="text-xs text-muted">Per dag</p>
            </div>
            <div className="flex shrink-0 items-center gap-1" role="group" aria-labelledby={`${ids}-goal`}>
              <button
                type="button"
                className="flex h-11 w-11 items-center justify-center rounded-xl border border-line text-lg font-semibold transition hover:border-muted active:scale-95 disabled:opacity-40"
                onClick={() => changeGoal(-step)}
                disabled={goal <= min}
                aria-label={`Stappendoel ${fmtSteps(step)} lager`}
              >
                −
              </button>
              <output className="w-20 text-center text-sm font-bold tabular-nums" aria-live="polite">
                {fmtSteps(goal)}
              </output>
              <button
                type="button"
                className="flex h-11 w-11 items-center justify-center rounded-xl border border-line text-lg font-semibold transition hover:border-muted active:scale-95 disabled:opacity-40"
                onClick={() => changeGoal(step)}
                disabled={goal >= max}
                aria-label={`Stappendoel ${fmtSteps(step)} hoger`}
              >
                +
              </button>
            </div>
          </div>

          {/* Calorieën terugverdienen: de instelling zelf staat bij Voeding. */}
          <a href="#calorieen-terugverdienen" className="flex min-h-12 items-center gap-3 px-4 py-3 transition hover:bg-surface-2/40">
            <div className="min-w-0 flex-1">
              <p className="text-sm font-medium">Calorieën terugverdienen</p>
              <p className="text-xs text-muted">Extra beweging bij je voedingsdoel optellen. Instellen bij Voeding.</p>
            </div>
            <span className="shrink-0 text-sm tabular-nums text-muted">{s.burn_credit_pct > 0 ? `${s.burn_credit_pct}%` : "Uit"}</span>
            <ChevronRightIcon size={16} className="shrink-0 text-muted" />
          </a>

          {/* Handmatig invoeren */}
          <button
            type="button"
            className="flex min-h-12 w-full items-center gap-3 px-4 py-3 text-left transition hover:bg-surface-2/40"
            onClick={() => setEntryOpen(true)}
            aria-haspopup="dialog"
          >
            <StepsIcon size={18} className="shrink-0 text-muted" />
            <div className="min-w-0 flex-1">
              <p className="text-sm font-medium">Handmatig invoeren</p>
              <p className="text-xs text-muted">Stappen en actieve kcal van de afgelopen 7 dagen</p>
            </div>
            <ChevronRightIcon size={16} className="shrink-0 text-muted" />
          </button>
        </div>
      )}

      {consented && (
        <SleepSettingsSection
          userId={userId}
          settings={s}
          onRequestConsent={() => requestConsent()}
          healthLinked={healthLink.connected}
        />
      )}

      {/* Koppelingen met telefoon en horloge */}
      <div className="card divide-y divide-line p-0">
        <HealthConnectPanel userId={userId} consented={consented} needsReconsent={s.needsReconsent} onRequestConsent={requestConsent} />
        <div className="flex min-h-12 items-center gap-3 px-4 py-3">
          <PhoneIcon size={18} className="shrink-0 text-muted" />
          <div className="min-w-0 flex-1">
            <p className="text-sm font-medium">Apple Health</p>
            <p className="text-xs text-muted">Voor iPhone en Apple Watch komt later een iOS-app.</p>
          </div>
          <StatusPill>Later</StatusPill>
        </div>
      </div>

      <div className="flex flex-wrap items-center justify-between gap-x-4">
        <Link href="/privacy" className="inline-flex min-h-11 items-center gap-1.5 text-xs font-semibold text-accent">
          <InfoIcon size={14} /> Privacyverklaring
        </Link>
        {consented && (
          <button
            type="button"
            className="inline-flex min-h-11 items-center gap-1.5 text-xs font-semibold text-muted transition hover:text-danger"
            onClick={() => setDeleteOpen(true)}
            aria-haspopup="dialog"
          >
            <TrashIcon size={14} /> Verwijder al mijn activiteitsgegevens
          </button>
        )}
      </div>

      <ConsentSheet
        open={consentOpen}
        onClose={() => {
          afterConsent.current = null;
          setConsentOpen(false);
        }}
        userId={userId}
        reconsent={s.needsReconsent}
        onConsented={() => {
          setConsentOpen(false);
          const then = afterConsent.current;
          afterConsent.current = null;
          then?.();
        }}
      />

      <ConfirmSheet
        open={withdrawOpen}
        onClose={() => setWithdrawOpen(false)}
        title="Activiteit bijhouden uitzetten"
        body={
          <>
            <span className="font-semibold text-ink">Al je stappen-, calorie- en slaapgegevens worden direct verwijderd.</span> Delen met
            vrienden, de AI-coach en calorieën terugverdienen gaan ook uit. Je kunt later opnieuw toestemming geven.
          </>
        }
        confirmLabel="Uitzetten en verwijderen"
        busyLabel="Verwijderen…"
        danger
        onConfirm={withdraw}
      />

      <ConfirmSheet
        open={deleteOpen}
        onClose={() => setDeleteOpen(false)}
        title="Activiteitsgegevens verwijderen"
        body={
          <>
            <span className="font-semibold text-ink">Al je opgeslagen stappen, actieve kcal en slaap worden definitief verwijderd</span>,
            van alle dagen, nachten en bronnen. Activiteit bijhouden blijft aan; zet het uit als je ook wilt stoppen met bijhouden.
            {healthLink.connected && " Health Connect wordt op dit toestel ontkoppeld, zodat de gegevens niet meteen terugkomen."}
          </>
        }
        confirmLabel="Alles verwijderen"
        busyLabel="Verwijderen…"
        danger
        onConfirm={removeAll}
      />

      {consented && <ActivityEntrySheet open={entryOpen} onClose={() => setEntryOpen(false)} userId={userId} />}
    </section>
  );
}

function StatusPill({ children }: { children: React.ReactNode }) {
  return <span className="chip shrink-0 px-2 py-0.5 text-[10px] font-semibold">{children}</span>;
}

function SwitchRow({
  id,
  label,
  description,
  on,
  busy,
  disabled,
  onToggle,
}: {
  id: string;
  label: string;
  description: React.ReactNode;
  on: boolean;
  busy: boolean;
  disabled: boolean;
  onToggle: () => void;
}) {
  return (
    <li className="flex items-center justify-between gap-3 py-3 first:pt-1 last:pb-1">
      <div className="min-w-0">
        <p id={`${id}-l`} className={`text-sm font-medium ${disabled && !on && !busy ? "text-muted" : ""}`}>
          {label}
        </p>
        <p id={`${id}-d`} className="text-xs text-muted">
          {description}
        </p>
      </div>
      <button
        type="button"
        role="switch"
        aria-checked={on}
        aria-labelledby={`${id}-l`}
        aria-describedby={`${id}-d`}
        aria-busy={busy}
        disabled={disabled}
        onClick={onToggle}
        className={`relative h-7 w-12 shrink-0 rounded-full transition-colors duration-200 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent disabled:opacity-50 ${
          on ? "bg-accent" : "bg-surface-2 ring-1 ring-line"
        }`}
      >
        <span
          className={`absolute top-1 h-5 w-5 rounded-full shadow transition-all duration-200 motion-reduce:transition-none ${
            on ? "left-6 bg-accent-ink" : "left-1 bg-muted"
          } ${busy ? "animate-pulse" : ""}`}
        />
      </button>
    </li>
  );
}
