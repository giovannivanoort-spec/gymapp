"use client";

import { useEffect, useState, useSyncExternalStore } from "react";
import { AlertIcon, ChevronRightIcon, ExternalIcon, RefreshIcon } from "@/components/Icons";
import { PhoneIcon } from "@/components/social/icons";
import { toast } from "@/components/ui/Toast";
import { APP_NAME } from "@/lib/brand";
import { appLabel } from "@/lib/activity";
import { relativeDay, timeAgo } from "@/lib/dates";
import { formatClockTime, formatSleepDuration } from "@/lib/sleep";
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
  nativeSupportsSleep,
  openHealthConnectSettings,
  requestHealthPermissions,
  syncDaysSince,
  syncHealth,
  useHealthLink,
  type HealthAvailability,
  type HealthPermissions,
  type HealthSleepPreview,
  type HealthSleepSyncResult,
  type HealthSyncResult,
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
const fmtInt = (n: number) => n.toLocaleString("nl-NL");
const fmtNights = (n: number) => (n === 1 ? "1 nacht" : `${n} nachten`);

/** Toastregel na een sync: dagen met stappen en (als het lukte) nachten. */
function syncSummary(r: HealthSyncResult): string {
  const nights = r.sleep.status === "ok" && r.sleep.sent > 0 ? ` en ${fmtNights(r.sleep.sent)} slaap` : "";
  return `${fmtDays(r.sent)}${nights}`;
}

/** Nachten die Health Connect bij de laatste slaapsync teruggaf (laatste 3 wakkerworddatums). */
function SleepPreview({ preview }: { preview: HealthSleepPreview[] }) {
  if (!preview.length) return null;
  const none = preview.every((d) => d.asleepMinutes == null);
  return (
    <div className="space-y-2">
      <p className="font-semibold text-ink">Slaap gevonden in Health Connect</p>
      <ul className="divide-y divide-line rounded-xl bg-surface-2">
        {preview.map((d) => (
          <li key={d.date} className="flex items-center justify-between gap-3 px-3 py-2">
            <span className="min-w-0 truncate">
              {relativeDay(d.date)}
              {d.app ? <span className="text-muted"> · {appLabel(d.app)}</span> : null}
            </span>
            <span className="shrink-0 tabular-nums text-ink">
              {d.asleepMinutes != null ? formatSleepDuration(d.asleepMinutes) : "geen nacht"}
              {d.bedtime && d.wakeTime ? (
                <span className="text-muted">
                  {" "}
                  · {formatClockTime(d.bedtime)}–{formatClockTime(d.wakeTime)}
                </span>
              ) : null}
            </span>
          </li>
        ))}
      </ul>
      {none && (
        <div className="space-y-1.5 rounded-xl border border-warn/40 p-3" role="status">
          <p className="font-semibold text-ink">Health Connect heeft geen slaap voor deze nachten</p>
          <p>{APP_NAME} kan alleen ophalen wat andere apps in Health Connect zetten. Controleer:</p>
          <ol className="list-decimal space-y-1 pl-5">
            <li>Samsung Health (ook Galaxy Watch): Samsung Health &gt; Instellingen &gt; Health Connect, en zet het delen van Slaap aan.</li>
            <li>Garmin: Garmin Connect &gt; Meer &gt; Instellingen &gt; Health Connect, en geef toegang tot slaap. Sync daarna je horloge.</li>
            <li>Droeg je je horloge niet, of synchroniseert het later? Dan verschijnt de nacht pas na de volgende sync van je horloge.</li>
          </ol>
        </div>
      )}
    </div>
  );
}

/** Wat Health Connect bij de laatste sync teruggaf, zodat je kunt zien of er wel data binnenkomt. */
function SyncPreview({ preview }: { preview: { date: string; steps: number | null; kcal: number | null; app?: string | null }[] }) {
  if (!preview.length) return null;
  const noSteps = preview.every((d) => d.steps == null || d.steps === 0);
  return (
    <div className="space-y-2">
      <p className="font-semibold text-ink">Gevonden in Health Connect</p>
      <ul className="divide-y divide-line rounded-xl bg-surface-2">
        {preview.map((d) => (
          <li key={d.date} className="flex items-center justify-between gap-3 px-3 py-2">
            <span>
              {relativeDay(d.date)}
              {d.app ? <span className="text-muted"> · {appLabel(d.app)}</span> : null}
            </span>
            <span className="tabular-nums text-ink">
              {d.steps != null ? `${fmtInt(d.steps)} stappen` : "geen stappen"}
              {d.kcal != null ? <span className="text-muted"> · {fmtInt(d.kcal)} kcal</span> : null}
            </span>
          </li>
        ))}
      </ul>
      {noSteps && (
        <div className="space-y-1.5 rounded-xl border border-warn/40 p-3" role="status">
          <p className="font-semibold text-ink">Health Connect heeft geen stappen voor deze dagen</p>
          <p>{APP_NAME} kan alleen ophalen wat andere apps in Health Connect zetten. Controleer:</p>
          <ol className="list-decimal space-y-1 pl-5">
            <li>
              Open Health Connect (knop hieronder) &gt; Gegevens en toegang &gt; Activiteit &gt; Stappen. Staan daar stappen van vandaag?
            </li>
            <li>Samsung: Samsung Health &gt; Instellingen &gt; Health Connect, en zet het delen van stappen aan.</li>
            <li>Garmin: Garmin Connect &gt; Meer &gt; Instellingen &gt; Health Connect, en geef toegang tot stappen. Sync daarna je horloge.</li>
            <li>Google Pixel: Fitbit of Google Health deelt via de Health Connect-instellingen van die app.</li>
          </ol>
          <p>Staan er daarna stappen in Health Connect, tik dan op Nu synchroniseren.</p>
        </div>
      )}
    </div>
  );
}

/**
 * Rij "Health Connect" in Profiel > Koppelingen.
 * - Web: uitleg dat dit met de Android-app komt.
 * - Android-app: verbinden (na toestemming in Spotter), status, nu synchroniseren, Health Connect
 *   openen en ontkoppelen.
 */
export function HealthConnectPanel({
  userId,
  consented,
  needsReconsent = false,
  onRequestConsent,
}: {
  userId: string;
  /** Toestemming om activiteit op te slaan (AVG) is gegeven. */
  consented: boolean;
  /** Toestemming gegeven voor een oudere tekst (zonder slaap): slaap wordt pas na opnieuw toestemming geven opgeslagen. */
  needsReconsent?: boolean;
  /** Toon het toestemmingsscherm; `then` wordt aangeroepen zodra de toestemming gegeven is. */
  onRequestConsent: (then?: () => void) => void;
}) {
  const android = useIsAndroidApp();
  if (!android) return <WebHealthConnectRow />;
  return <NativeHealthConnectRow userId={userId} consented={consented} needsReconsent={needsReconsent} onRequestConsent={onRequestConsent} />;
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
          <p className="text-xs text-muted">Android: Samsung Health, Galaxy Watch, Garmin en meer</p>
        </div>
        <StatusPill>Android-app, binnenkort</StatusPill>
        <ChevronRightIcon size={16} className="shrink-0 text-muted transition-transform group-open:rotate-90" />
      </summary>
      <div className="space-y-2 px-4 pb-4 text-xs text-muted">
        <p>
          Een website kan niet bij Health Connect. Met de Android-app van {APP_NAME} worden je stappen, actieve kcal en slaap
          automatisch opgehaald. Zo werkt het:
        </p>
        <ol className="list-decimal space-y-1 pl-5">
          <li>Garmin Connect, Samsung Health en Google Health (Fitbit) schrijven naar Health Connect.</li>
          <li>Zet dat aan in de instellingen van die app, voor stappen en voor slaap.</li>
          <li>Zet in Health Connect onder App-prioriteit de app van je horloge bovenaan, zodat stappen niet dubbel tellen.</li>
          <li>Garmin Connect werkt met Health Connect vanaf Android 14.</li>
        </ol>
        <p>
          Heb je de Android-app al? Open {APP_NAME} dan daar en verbind Health Connect in dit scherm. Tot die tijd kun je je stappen en je
          slaap handmatig invoeren.
        </p>
      </div>
    </details>
  );
}

function NativeHealthConnectRow({
  userId,
  consented,
  needsReconsent,
  onRequestConsent,
}: {
  userId: string;
  consented: boolean;
  needsReconsent: boolean;
  onRequestConsent: (then?: () => void) => void;
}) {
  const link = useHealthLink(userId);
  const [availability, setAvailability] = useState<HealthAvailability | null>(null);
  const [perms, setPerms] = useState<HealthPermissions | null>(null);
  const [busy, setBusy] = useState<"connect" | "sync" | "sleep" | null>(null);
  /** Kan deze versie van de app slaap lezen (oudere APK's niet)? null = nog onbekend. */
  const [sleepSupported, setSleepSupported] = useState<boolean | null>(null);
  /** Uitkomst van de slaap bij de laatste sync vanuit dit scherm (fouten tonen we hier, niet stil). */
  const [sleepResult, setSleepResult] = useState<HealthSleepSyncResult | null>(null);
  const [recheck, setRecheck] = useState(0);
  const connected = link.connected && consented;

  // Beschikbaarheid, en bij een koppeling de huidige rechten (die kunnen in Health Connect zijn ingetrokken).
  // Opnieuw bij terugkeer naar de app: na installeren/bijwerken in de Play Store of rechten aanpassen in Health Connect.
  useEffect(() => {
    let alive = true;
    async function check() {
      const [a, sleepOk] = await Promise.all([healthAvailability(), nativeSupportsSleep()]);
      if (!alive) return;
      setAvailability(a);
      setSleepSupported(sleepOk);
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
  }, [link.connected, link.lastSyncAt, recheck]);

  /**
   * `afterConsent`: net toestemming gegeven (voor de huidige tekst, die slaap noemt); de props `consented`
   * en `needsReconsent` zijn dan nog niet bijgewerkt.
   */
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
        toast.error(
          a.status === "needs_install"
            ? "Installeer of werk eerst Health Connect bij."
            : a.status === "error"
              ? (a.reason ?? "Health Connect kon niet worden gecontroleerd. Probeer het opnieuw.")
              : "Health Connect werkt niet op dit toestel.",
        );
        return;
      }
      // Slaap alleen vragen met toestemming in Spotter voor de tekst die slaap noemt.
      const sleepConsent = afterConsent || !needsReconsent;
      const p = await requestHealthPermissions({ sleep: sleepConsent });
      setPerms(p);
      if (!p.steps && !(p.sleep && sleepConsent)) {
        // Na twee keer weigeren toont Android het rechtenscherm niet meer; dan kan het alleen nog in Health Connect zelf.
        toast.error(`Zonder toegang tot je stappen kan ${APP_NAME} niets ophalen. Zet Stappen aan in Health Connect > App-rechten > ${APP_NAME}.`, {
          action: { label: "Health Connect openen", run: () => void openSettings() },
        });
        return;
      }
      markHealthConnected(userId);
      // Alle dagen sinds de laatste geslaagde sync (na lang geen toegang), minstens 7; nog nooit: 30.
      const r = await syncHealth(userId, { days: syncDaysSince(getHealthLink(userId).lastSyncAt, HEALTH_SYNC_DAYS), sleepConsent, manual: true });
      setSleepResult(r.sleep);
      toast.success(r.sent > 0 || r.sleep.sent > 0 ? `Verbonden met Health Connect. ${syncSummary(r)} opgehaald.` : "Verbonden met Health Connect. Er is nog geen data gevonden.");
    } catch (err) {
      toast.error(healthErrorMessage(err));
    } finally {
      setBusy(null);
    }
  }

  /** `afterReconsent`: net opnieuw toestemming gegeven; de prop `needsReconsent` is dan nog niet bijgewerkt. */
  async function syncNow(afterReconsent = false) {
    if (busy) return;
    setBusy("sync");
    try {
      const r = await syncHealth(userId, {
        days: syncDaysSince(getHealthLink(userId).lastSyncAt, HEALTH_SYNC_DAYS),
        sleepConsent: afterReconsent || !needsReconsent,
        manual: true,
      });
      setSleepResult(r.sleep);
      toast.success(r.sent > 0 || r.sleep.sent > 0 ? `Gesynchroniseerd: ${syncSummary(r)} bijgewerkt` : "Gesynchroniseerd. Geen nieuwe data gevonden.");
    } catch (err) {
      toast.error(healthErrorMessage(err));
    } finally {
      setBusy(null);
    }
  }

  /** Bestaande koppeling: alleen het recht op slaap erbij vragen en meteen synchroniseren. */
  async function enableSleep() {
    if (busy) return;
    setBusy("sleep");
    try {
      const p = await requestHealthPermissions();
      setPerms(p);
      if (!p.sleep) {
        toast.error(`Zonder toegang tot je slaap haalt ${APP_NAME} alleen stappen op. Zet Slaap aan in Health Connect > App-rechten > ${APP_NAME}.`, {
          action: { label: "Health Connect openen", run: () => void openSettings() },
        });
        return;
      }
      // Alleen bereikbaar zonder needsReconsent (SleepStatus toont anders eerst "Toestemming bijwerken").
      const r = await syncHealth(userId, { days: syncDaysSince(getHealthLink(userId).lastSyncAt, HEALTH_SYNC_DAYS), sleepConsent: true, manual: true });
      setSleepResult(r.sleep);
      if (r.sleep.status === "ok") toast.success(r.sleep.sent > 0 ? `Slaap opgehaald: ${fmtNights(r.sleep.sent)}` : "Slaap staat aan. Er is nog geen nacht gevonden.");
      else toast.error(r.sleep.message ?? "Je slaap kon niet worden opgehaald.");
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
  // Geen toegang meer: stappen én slaap ingetrokken. Alleen stappen weg: slaap wordt nog wel opgehaald.
  const stepsRevoked = connected && perms !== null && !perms.steps && !perms.sleep;
  const sleepOnly = connected && perms !== null && !perms.steps && perms.sleep;
  const pill = !availability ? (
    <StatusPill>Controleren…</StatusPill>
  ) : status === "needs_install" ? (
    <StatusPill tone="warn">Installeren</StatusPill>
  ) : status === "unsupported" ? (
    <StatusPill>Niet beschikbaar</StatusPill>
  ) : status === "error" ? (
    <StatusPill tone="warn">Geen antwoord</StatusPill>
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
          <p className="text-xs text-muted">Stappen, actieve kcal en slaap van je telefoon en horloge</p>
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

      {status === "error" && (
        <div className="space-y-2 text-xs text-muted">
          <p>{availability?.reason ?? "Health Connect kon niet worden gecontroleerd."}</p>
          <button
            type="button"
            className="btn-ghost w-full text-xs"
            onClick={() => {
              setAvailability(null);
              setRecheck((n) => n + 1);
            }}
          >
            <RefreshIcon size={14} /> Opnieuw controleren
          </button>
        </div>
      )}

      {status === "unsupported" && (
        <p className="text-xs text-muted">Health Connect werkt niet op dit toestel. Daarvoor is Android 9 of nieuwer nodig. Je kunt je stappen wel handmatig invoeren.</p>
      )}

      {status === "available" && !connected && (
        <div className="space-y-2 text-xs text-muted">
          <p>
            {APP_NAME} leest alleen je dagtotalen van stappen en actieve kcal en per nacht een samenvatting van je slaap, en schrijft
            niets in Health Connect. Je kiest zelf welke rechten je geeft. Je slaap blijft privé.
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
                  {APP_NAME} mag je stappen en slaap niet meer lezen. Geef opnieuw toestemming om verder te synchroniseren. Verschijnt er
                  geen vraag, open dan Health Connect hieronder en zet Stappen (en eventueel Slaap) aan onder App-rechten &gt; {APP_NAME}.
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
          {!stepsRevoked && !sleepOnly && link.lastSyncAt ? <SyncPreview preview={link.lastSyncPreview} /> : null}
          {perms && perms.steps && !perms.calories && (
            <p>Alleen stappen worden opgehaald. Wil je ook actieve kcal, zet dat dan aan in Health Connect.</p>
          )}
          {sleepOnly && (
            <p>
              Alleen slaap wordt opgehaald. Wil je ook je stappen, zet Stappen dan aan in Health Connect &gt; App-rechten &gt; {APP_NAME}.
            </p>
          )}
          {!stepsRevoked && perms && (
            <SleepStatus
              supported={sleepSupported}
              allowed={perms.sleep}
              needsReconsent={needsReconsent}
              result={sleepResult}
              lastSleepSyncAt={link.lastSleepSyncAt}
              preview={link.lastSleepPreview}
              busy={busy !== null}
              onEnable={() => void enableSleep()}
              onReconsent={() => onRequestConsent(() => void syncNow(true))}
            />
          )}
          <p>{APP_NAME} synchroniseert vanzelf als je de app opent (hooguit elk kwartier), en haalt de laatste dagen opnieuw op omdat horloges vaak later bijwerken.</p>
          <div className="grid grid-cols-2 gap-2">
            <button type="button" className="btn-primary text-xs" onClick={() => void syncNow()} disabled={busy !== null || stepsRevoked} aria-busy={busy === "sync"}>
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

/** Slaap binnen een bestaande koppeling: app te oud, geen recht, opnieuw toestemming nodig, of wat er binnenkwam. */
function SleepStatus({
  supported,
  allowed,
  needsReconsent,
  result,
  lastSleepSyncAt,
  preview,
  busy,
  onEnable,
  onReconsent,
}: {
  supported: boolean | null;
  allowed: boolean;
  needsReconsent: boolean;
  result: HealthSleepSyncResult | null;
  lastSleepSyncAt: string | null;
  preview: HealthSleepPreview[];
  busy: boolean;
  onEnable: () => void;
  onReconsent: () => void;
}) {
  const privacy = <p>Je slaap blijft privé: vrienden, groepen en je trainer zien hem niet.</p>;
  if (supported === null) return null;
  if (!supported) {
    return (
      <div className="space-y-1 rounded-xl bg-surface-2 p-3">
        <p className="font-semibold text-ink">Slaap ophalen</p>
        <p>Deze versie van de {APP_NAME}-app kan je slaap nog niet lezen. Werk de app bij om ook je slaap uit Health Connect te halen.</p>
      </div>
    );
  }
  if (needsReconsent) {
    return (
      <div className="space-y-2 rounded-xl border border-accent/40 p-3" role="status">
        <p className="font-semibold text-ink">Slaap ophalen</p>
        <p>Je slaap wordt pas opgeslagen als je opnieuw toestemming geeft. Je stappen blijven gewoon synchroniseren.</p>
        <button type="button" className="btn-primary min-h-11 w-full text-xs" onClick={onReconsent} disabled={busy}>
          Toestemming bijwerken
        </button>
      </div>
    );
  }
  if (!allowed) {
    return (
      <div className="space-y-2 rounded-xl bg-surface-2 p-3">
        <div className="flex items-center justify-between gap-2">
          <p className="font-semibold text-ink">Slaap ophalen</p>
          <StatusPill>Uit</StatusPill>
        </div>
        <p>
          Haal ook je slaap op uit Samsung Health, je Galaxy Watch, Garmin of een andere app die naar Health Connect schrijft. Health
          Connect vraagt dan om toegang tot Slaap.
        </p>
        <button type="button" className="btn-primary min-h-11 w-full text-xs" onClick={onEnable} disabled={busy} aria-busy={busy}>
          Slaap ook ophalen
        </button>
        {privacy}
      </div>
    );
  }
  const failed = !!result && (result.status === "error" || result.status === "unavailable" || result.status === "needs_reconsent");
  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between gap-2">
        <p className="font-semibold text-ink">Slaap</p>
        <span className="tabular-nums">{lastSleepSyncAt ? `Laatste sync ${timeAgo(lastSleepSyncAt)}` : "Nog niet gesynchroniseerd"}</span>
      </div>
      {failed && (
        <div className="flex items-start gap-2 rounded-xl border border-warn/40 p-3" role="status">
          <AlertIcon size={16} className="mt-0.5 shrink-0 text-warn" />
          <p>{result?.message ?? "Je slaap kon niet worden opgehaald. Je stappen zijn wel bijgewerkt."}</p>
        </div>
      )}
      {lastSleepSyncAt ? <SleepPreview preview={preview} /> : null}
      {privacy}
    </div>
  );
}
