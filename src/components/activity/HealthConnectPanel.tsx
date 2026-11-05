"use client";

import { useEffect, useState, useSyncExternalStore } from "react";
import { AlertIcon, ChevronRightIcon, ExternalIcon, RefreshIcon } from "@/components/Icons";
import { PhoneIcon } from "@/components/social/icons";
import { toast } from "@/components/ui/Toast";
import { APP_NAME } from "@/lib/brand";
import { timeAgo } from "@/lib/dates";
import {
  disconnectHealth,
  getHealthLink,
  HEALTH_CONNECT_PLAY_URL,
  HEALTH_SYNC_DAYS,
  healthAvailability,
  healthErrorMessage,
  healthPermissions,
  isNativeApp,
  markHealthConnected,
  nativePlatform,
  openHealthConnectSettings,
  requestHealthPermissions,
  syncDaysSince,
  syncHealth,
  useHealthLink,
  type HealthAvailability,
  type HealthPermissions,
} from "@/lib/native/health";

const noopSubscribe = () => () => {};

/** In de Android-app? Op de server en tijdens hydratie false, daarna de echte waarde. */
function useIsAndroidApp(): boolean {
  return useSyncExternalStore(
    noopSubscribe,
    () => isNativeApp() && nativePlatform() === "android",
    () => false,
  );
}

const fmtDays = (n: number) => (n === 1 ? "1 dag" : `${n} dagen`);

/**
 * Rij "Health Connect" in Profiel > Koppelingen.
 * - Web: uitleg dat dit met de Android-app komt.
 * - Android-app: verbinden (na toestemming in Spotter), status, nu synchroniseren, Health Connect
 *   openen en ontkoppelen.
 */
export function HealthConnectPanel({
  userId,
  consented,
  onRequestConsent,
}: {
  userId: string;
  /** Toestemming om activiteit op te slaan (AVG) is gegeven. */
  consented: boolean;
  /** Toon het toestemmingsscherm; `then` wordt aangeroepen zodra de toestemming gegeven is. */
  onRequestConsent: (then?: () => void) => void;
}) {
  const android = useIsAndroidApp();
  if (!android) return <WebHealthConnectRow />;
  return <NativeHealthConnectRow userId={userId} consented={consented} onRequestConsent={onRequestConsent} />;
}

function StatusPill({ children, tone = "muted" }: { children: React.ReactNode; tone?: "muted" | "accent" | "warn" }) {
  const color = tone === "accent" ? "text-accent" : tone === "warn" ? "text-warn" : "";
  return <span className={`chip shrink-0 px-2 py-0.5 text-[10px] font-semibold ${color}`}>{children}</span>;
}

/** Tip die in beide varianten terugkomt. */
function PriorityTip() {
  return (
    <p>
      Tip: zet in Health Connect onder <span className="font-semibold text-ink">App-prioriteit</span> de app van je horloge (Garmin
      Connect, Samsung Health) bovenaan. Dan kiest Health Connect bij dubbele metingen die van je horloge en telt het stappen niet dubbel.
    </p>
  );
}

function WebHealthConnectRow() {
  return (
    <details className="group">
      <summary className="flex min-h-12 cursor-pointer list-none items-center gap-3 px-4 py-3 transition hover:bg-surface-2/40 [&::-webkit-details-marker]:hidden">
        <PhoneIcon size={18} className="shrink-0 text-muted" />
        <div className="min-w-0 flex-1">
          <p className="text-sm font-medium">Health Connect</p>
          <p className="text-xs text-muted">Android: Garmin, Samsung Health, Google Health en meer</p>
        </div>
        <StatusPill>Android-app, binnenkort</StatusPill>
        <ChevronRightIcon size={16} className="shrink-0 text-muted transition-transform group-open:rotate-90" />
      </summary>
      <div className="space-y-2 px-4 pb-4 text-xs text-muted">
        <p>
          Een website kan niet bij Health Connect. Met de Android-app van {APP_NAME} worden je stappen en actieve kcal automatisch
          opgehaald. Zo werkt het:
        </p>
        <ol className="list-decimal space-y-1 pl-5">
          <li>Garmin Connect, Samsung Health en Google Health (Fitbit) schrijven naar Health Connect.</li>
          <li>Zet dat aan in de instellingen van die app.</li>
          <li>Zet in Health Connect onder App-prioriteit de app van je horloge bovenaan, zodat stappen niet dubbel tellen.</li>
          <li>Garmin Connect werkt met Health Connect vanaf Android 14.</li>
        </ol>
        <p>Heb je de Android-app al? Open {APP_NAME} dan daar en verbind Health Connect in dit scherm. Tot die tijd kun je je stappen handmatig invoeren.</p>
      </div>
    </details>
  );
}

function NativeHealthConnectRow({
  userId,
  consented,
  onRequestConsent,
}: {
  userId: string;
  consented: boolean;
  onRequestConsent: (then?: () => void) => void;
}) {
  const link = useHealthLink(userId);
  const [availability, setAvailability] = useState<HealthAvailability | null>(null);
  const [perms, setPerms] = useState<HealthPermissions | null>(null);
  const [busy, setBusy] = useState<"connect" | "sync" | null>(null);
  const connected = link.connected && consented;

  // Beschikbaarheid, en bij een koppeling de huidige rechten (die kunnen in Health Connect zijn ingetrokken).
  // Opnieuw bij terugkeer naar de app: na installeren/bijwerken in de Play Store of rechten aanpassen in Health Connect.
  useEffect(() => {
    let alive = true;
    async function check() {
      const a = await healthAvailability();
      if (!alive) return;
      setAvailability(a);
      if (a.status === "available" && link.connected) {
        const p = await healthPermissions().catch(() => null);
        if (alive) setPerms(p);
      }
    }
    function onVisible() {
      if (document.visibilityState === "visible") void check();
    }
    void check();
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      alive = false;
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, [link.connected, link.lastSyncAt]);

  /** `afterConsent`: net toestemming gegeven, de prop `consented` is dan nog niet bijgewerkt. */
  async function connect(afterConsent = false) {
    if (busy) return;
    if (!consented && !afterConsent) {
      // Na de toestemming meteen verder met verbinden.
      onRequestConsent(() => void connect(true));
      return;
    }
    setBusy("connect");
    try {
      const a = await healthAvailability();
      setAvailability(a);
      if (a.status !== "available") {
        toast.error(a.status === "needs_install" ? "Installeer of werk eerst Health Connect bij." : "Health Connect werkt niet op dit toestel.");
        return;
      }
      const p = await requestHealthPermissions();
      setPerms(p);
      if (!p.steps) {
        // Na twee keer weigeren toont Android het rechtenscherm niet meer; dan kan het alleen nog in Health Connect zelf.
        toast.error(`Zonder toegang tot je stappen kan ${APP_NAME} niets ophalen. Zet Stappen aan in Health Connect > App-rechten > ${APP_NAME}.`, {
          action: { label: "Health Connect openen", run: () => void openSettings() },
        });
        return;
      }
      markHealthConnected(userId);
      // Alle dagen sinds de laatste geslaagde sync (na lang geen toegang), minstens 7; nog nooit: 30.
      const r = await syncHealth(userId, { days: syncDaysSince(getHealthLink(userId).lastSyncAt, HEALTH_SYNC_DAYS) });
      toast.success(r.sent > 0 ? `Verbonden met Health Connect. ${fmtDays(r.sent)} opgehaald.` : "Verbonden met Health Connect. Er is nog geen data gevonden.");
    } catch (err) {
      toast.error(healthErrorMessage(err));
    } finally {
      setBusy(null);
    }
  }

  async function syncNow() {
    if (busy) return;
    setBusy("sync");
    try {
      const r = await syncHealth(userId, { days: syncDaysSince(getHealthLink(userId).lastSyncAt, HEALTH_SYNC_DAYS) });
      toast.success(r.sent > 0 ? `Gesynchroniseerd: ${fmtDays(r.sent)} bijgewerkt` : "Gesynchroniseerd. Geen nieuwe data gevonden.");
    } catch (err) {
      toast.error(healthErrorMessage(err));
    } finally {
      setBusy(null);
    }
  }

  async function openSettings() {
    try {
      await openHealthConnectSettings();
    } catch {
      toast.error("Health Connect kon niet worden geopend.");
    }
  }

  function disconnect() {
    if (busy) return;
    disconnectHealth(userId);
    setPerms(null);
    toast.success("Health Connect is ontkoppeld. Trek de rechten ook in via Health Connect als je wilt.", {
      action: { label: "Openen", run: () => void openSettings() },
    });
  }

  const status = availability?.status;
  const stepsRevoked = connected && perms !== null && !perms.steps;
  const pill = !availability ? (
    <StatusPill>Controleren…</StatusPill>
  ) : status === "needs_install" ? (
    <StatusPill tone="warn">Installeren</StatusPill>
  ) : status === "unsupported" ? (
    <StatusPill>Niet beschikbaar</StatusPill>
  ) : stepsRevoked ? (
    <StatusPill tone="warn">Geen toegang</StatusPill>
  ) : connected ? (
    <StatusPill tone="accent">Verbonden</StatusPill>
  ) : (
    <StatusPill>Niet verbonden</StatusPill>
  );

  return (
    <div className="space-y-3 px-4 py-3">
      <div className="flex min-h-6 items-center gap-3">
        <PhoneIcon size={18} className="shrink-0 text-muted" />
        <div className="min-w-0 flex-1">
          <p className="text-sm font-medium">Health Connect</p>
          <p className="text-xs text-muted">Stappen en actieve kcal van je telefoon en horloge</p>
        </div>
        {pill}
      </div>

      {status === "needs_install" && (
        <div className="space-y-2 text-xs text-muted">
          <p>Health Connect moet nog geïnstalleerd of bijgewerkt worden. Doe dat in de Play Store en kom daarna terug.</p>
          <a href={HEALTH_CONNECT_PLAY_URL} className="btn-ghost w-full text-xs">
            <ExternalIcon size={14} /> Health Connect in de Play Store
          </a>
        </div>
      )}

      {status === "unsupported" && (
        <p className="text-xs text-muted">Health Connect werkt niet op dit toestel. Daarvoor is Android 9 of nieuwer nodig. Je kunt je stappen wel handmatig invoeren.</p>
      )}

      {status === "available" && !connected && (
        <div className="space-y-2 text-xs text-muted">
          <p>
            {APP_NAME} leest alleen je dagtotalen van stappen en actieve kcal, en schrijft niets in Health Connect. Je kiest zelf welke
            rechten je geeft.
            {!consented && " Eerst vragen we je toestemming om activiteit op te slaan."}
          </p>
          <button type="button" className="btn-primary w-full" onClick={() => void connect()} disabled={busy !== null} aria-busy={busy === "connect"}>
            {busy === "connect" ? <span className="spinner" aria-hidden /> : null}
            Verbinden met Health Connect
          </button>
        </div>
      )}

      {status === "available" && connected && (
        <div className="space-y-3 text-xs text-muted">
          {stepsRevoked ? (
            <div className="flex items-start gap-2 rounded-xl border border-warn/40 p-3" role="status">
              <AlertIcon size={16} className="mt-0.5 shrink-0 text-warn" />
              <div className="min-w-0 flex-1 space-y-2">
                <p>
                  {APP_NAME} mag je stappen niet meer lezen. Geef opnieuw toestemming om verder te synchroniseren. Verschijnt er geen
                  vraag, open dan Health Connect hieronder en zet Stappen aan onder App-rechten &gt; {APP_NAME}.
                </p>
                <button type="button" className="btn-primary w-full text-xs" onClick={() => void connect()} disabled={busy !== null}>
                  Opnieuw toestemming geven
                </button>
              </div>
            </div>
          ) : (
            <dl className="grid grid-cols-2 gap-2">
              <div className="rounded-xl bg-surface-2 px-3 py-2">
                <dt>Laatste sync</dt>
                <dd className="text-sm font-semibold text-ink">{link.lastSyncAt ? timeAgo(link.lastSyncAt) : "Nog niet"}</dd>
              </div>
              <div className="rounded-xl bg-surface-2 px-3 py-2">
                <dt>Dagen met data</dt>
                <dd className="text-sm font-semibold tabular-nums text-ink">{link.lastSyncAt ? link.lastSyncDays : "–"}</dd>
              </div>
            </dl>
          )}
          {perms && perms.steps && !perms.calories && (
            <p>Alleen stappen worden opgehaald. Wil je ook actieve kcal, zet dat dan aan in Health Connect.</p>
          )}
          <p>{APP_NAME} synchroniseert vanzelf als je de app opent (hooguit elk kwartier), en haalt de laatste dagen opnieuw op omdat horloges vaak later bijwerken.</p>
          <div className="grid grid-cols-2 gap-2">
            <button type="button" className="btn-primary text-xs" onClick={syncNow} disabled={busy !== null || stepsRevoked} aria-busy={busy === "sync"}>
              {busy === "sync" ? <span className="spinner" aria-hidden /> : <RefreshIcon size={14} />}
              Nu synchroniseren
            </button>
            <button type="button" className="btn-ghost text-xs" onClick={openSettings}>
              <ExternalIcon size={14} /> Health Connect
            </button>
          </div>
          <PriorityTip />
          <button
            type="button"
            className="inline-flex min-h-11 items-center text-xs font-semibold text-muted transition hover:text-danger disabled:opacity-50"
            onClick={disconnect}
            disabled={busy !== null}
          >
            Ontkoppelen op dit toestel
          </button>
        </div>
      )}

      {status === "available" && !connected && (
        <div className="text-xs text-muted">
          <PriorityTip />
        </div>
      )}
    </div>
  );
}
