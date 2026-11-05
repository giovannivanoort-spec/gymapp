"use client";

import Image from "next/image";
import { useRouter, useSearchParams } from "next/navigation";
import { Suspense, useEffect, useRef, useState, useSyncExternalStore } from "react";
import { linkErrorFromHash, useAuth, type LinkError } from "@/components/AuthProvider";
import { AlertIcon, CheckIcon, ChevronLeftIcon, ClockIcon, InfoIcon, LockIcon, MailIcon, UsersIcon } from "@/components/Icons";
import { authErrorMessage } from "@/components/shell/authErrors";
import { MIN_PASSWORD, NewPasswordForm, StrengthMeter } from "@/components/shell/NewPasswordForm";
import { PasswordInput } from "@/components/shell/PasswordInput";
import { Splash } from "@/components/shell/Splash";
import { APP_NAME, APP_TAGLINE } from "@/lib/brand";
import { supabase } from "@/lib/supabase";

const noopSubscribe = () => () => {};
/** Huidige hash, live gelezen (geen kopie van bij het laden, die na uitloggen nog zou gelden). */
const readHash = () => window.location.hash;

/** Laatst gebruikte e-mailadres op dit apparaat (alleen gemak; blijft staan na uitloggen). */
const LAST_EMAIL_KEY = "spotter:last-email";
/** Supabase laat per adres maar één mail per minuut toe; zo lang blijft de knop uit. */
const MAIL_COOLDOWN_S = 60;

function readLastEmail(): string {
  try {
    return window.localStorage.getItem(LAST_EMAIL_KEY) ?? "";
  } catch {
    return "";
  }
}

function rememberEmail(mail: string) {
  try {
    window.localStorage.setItem(LAST_EMAIL_KEY, mail);
  } catch {
    // privévenster of geblokkeerde opslag: dan gewoon niet onthouden
  }
}

const LINK_ERROR_TEXT: Record<LinkError, string> = {
  verlopen: "Deze link is verlopen of al gebruikt. Vraag hieronder een nieuwe aan.",
  ongeldig: "De link uit je mail werkte niet. Probeer het opnieuw of vraag een nieuwe aan.",
};

/** Simpele controle op de vorm van een e-mailadres (de server controleert de rest). */
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const NOTICE_ID = "auth-notice";

/*
 * Mailcooldown over herladen heen: Supabase staat per adres maar één mail per minuut toe.
 * Zonder dit kon je na het opnieuw openen van de app meteen weer op de limiet stuiten.
 */
const COOLDOWN_KEY = "spotter:mail-cooldown";

function readCooldownUntil(): number {
  try {
    const until = Number(window.localStorage.getItem(COOLDOWN_KEY) ?? 0);
    return until > Date.now() ? until : 0;
  } catch {
    return 0;
  }
}

function storeCooldownUntil(until: number) {
  try {
    window.localStorage.setItem(COOLDOWN_KEY, String(until));
  } catch {
    // geen opslag: dan alleen in dit scherm
  }
}

export default function LoginPage() {
  return (
    <Suspense fallback={<Splash />}>
      <LoginScreen />
    </Suspense>
  );
}

type Mode = "login" | "signup" | "forgot";
/** error = rood, info = groen (gelukt/verstuurd), note = neutrale uitleg (bijv. sessie verlopen). */
type Notice = { kind: "error" | "info" | "note"; text: string } | null;

function LoginScreen() {
  const { session, loading } = useAuth();
  const router = useRouter();
  const params = useSearchParams();
  const next = params.get("next") || "/";
  // Alleen interne paden: geen "//andere-site" of volledige URL's (open redirect).
  const safeNext = next.startsWith("/") && !next.startsWith("//") && !next.startsWith("/\\") ? next : "/";
  const resetting = params.get("reset") === "1";
  const expired = params.get("expired") === "1" && safeNext !== "/";
  const invited = /^\/join\/[^/?#]+/.test(safeNext);
  // ?link= van de AuthProvider (ook als de link op een andere pagina uitkwam), anders de hash zelf.
  const hash = useSyncExternalStore(noopSubscribe, readHash, () => "");
  const linkParam = params.get("link");
  const linkKind: LinkError | null =
    linkParam === "verlopen" || linkParam === "ongeldig" ? linkParam : linkParam ? "ongeldig" : linkErrorFromHash(hash);
  const linkError = linkKind ? LINK_ERROR_TEXT[linkKind] : null;

  useEffect(() => {
    if (session && !resetting) router.replace(safeNext);
  }, [session, resetting, safeNext, router]);

  // Herstellink geopend: eerst wachten tot de sessie uit de link binnen is.
  if (resetting && loading) return <Splash />;

  if (resetting && session) {
    return (
      <Layout subtitle="Kies een nieuw wachtwoord voor je account.">
        <div className="animate-fade-up card" style={{ "--i": 2 } as React.CSSProperties}>
          <div className="mb-4 flex items-center gap-3">
            <span className="flex h-10 w-10 items-center justify-center rounded-xl bg-accent/15 text-accent">
              <LockIcon size={18} />
            </span>
            <div className="min-w-0">
              <h2 className="font-bold">Nieuw wachtwoord</h2>
              <p className="truncate text-xs text-muted">{session.user.email}</p>
            </div>
          </div>
          <NewPasswordForm autoFocus submitLabel="Opslaan en verder" onDone={() => router.replace(safeNext)} />
        </div>
      </Layout>
    );
  }

  return (
    <AuthForms
      // Andere uitleg (bijv. de linkfout komt binnen): formulier opnieuw beginnen met die uitleg.
      key={`${linkKind ?? ""}|${resetting ? 1 : 0}|${expired ? 1 : 0}`}
      safeNext={safeNext}
      // Herstellink zonder geldige sessie: meteen naar "wachtwoord vergeten" met uitleg.
      initialMode={resetting || linkError ? "forgot" : "login"}
      initialNotice={
        linkError
          ? { kind: "error", text: linkError }
          : resetting
            ? { kind: "error", text: "Deze herstellink is verlopen of al gebruikt. Vraag hieronder een nieuwe aan." }
            : expired
              ? { kind: "note", text: "Je sessie is verlopen. Log opnieuw in, dan ga je verder waar je was." }
              : null
      }
      invited={invited}
    />
  );
}

function Layout({ subtitle, children }: { subtitle: string; children: React.ReactNode }) {
  return (
    <main className="mx-auto flex min-h-dvh max-w-sm flex-col justify-center px-6 pb-[max(2.5rem,env(safe-area-inset-bottom))] pt-[max(2.5rem,env(safe-area-inset-top))]">
      <div className="animate-fade-up mb-8 text-center">
        <div className="relative mx-auto mb-4 h-16 w-16">
          <span aria-hidden className="absolute inset-0 rounded-[20px] bg-accent/20 blur-xl" />
          <Image src="/icon.svg" alt="" width={64} height={64} className="relative rounded-[18px]" priority />
        </div>
        <h1 className="text-3xl font-extrabold tracking-tight">{APP_NAME}</h1>
        <p className="mt-1 text-muted">{subtitle}</p>
      </div>
      {children}
    </main>
  );
}


/**
 * Aftellen na het versturen van een mail, zodat je niet tegen de limiet van Supabase aan tikt.
 * Het eindmoment staat in localStorage, dus herladen of de app opnieuw openen begint niet bij nul.
 */
function useCooldown() {
  const stored = useSyncExternalStore(noopSubscribe, readCooldownUntil, () => 0);
  const [own, setOwn] = useState(0);
  const until = Math.max(own, stored);
  const [now, setNow] = useState(0);
  useEffect(() => {
    if (!until) return;
    const tick = () => {
      const n = Date.now();
      setNow(n);
      if (n >= until) setOwn(0);
    };
    // Eerste tik meteen (asynchroon), daarna elke seconde.
    const first = setTimeout(tick, 0);
    const t = setInterval(tick, 1000);
    return () => {
      clearTimeout(first);
      clearInterval(t);
    };
  }, [until]);
  const remaining = until && now ? Math.max(0, Math.ceil((until - now) / 1000)) : until ? MAIL_COOLDOWN_S : 0;
  function start(seconds = MAIL_COOLDOWN_S) {
    const n = Date.now();
    const end = n + seconds * 1000;
    setNow(n);
    setOwn(end);
    storeCooldownUntil(end);
  }
  return { remaining, start };
}

/** "Wacht nog 37 seconden" van Supabase: het aantal seconden, of null. */
function retryAfterSeconds(err: unknown): number | null {
  const msg = err && typeof err === "object" && "message" in err ? String((err as { message?: unknown }).message ?? "") : "";
  const s = msg.match(/after (\d+) seconds?/i)?.[1];
  return s ? Number(s) : null;
}

function isUnconfirmed(err: unknown): boolean {
  const o = (err ?? {}) as { code?: unknown; message?: unknown };
  return o.code === "email_not_confirmed" || /email not confirmed/i.test(String(o.message ?? ""));
}

type MailKind = "forgot" | "link" | "confirm";
type Field = "name" | "email" | "password";

function AuthForms({
  safeNext,
  initialMode,
  initialNotice,
  invited = false,
}: {
  safeNext: string;
  initialMode: Mode;
  initialNotice: Notice;
  invited?: boolean;
}) {
  const [mode, setMode] = useState<Mode>(invited && initialMode === "login" ? "signup" : initialMode);
  const [name, setName] = useState("");
  // Zolang je niets typt, staat het laatst gebruikte adres van dit apparaat erin.
  const storedEmail = useSyncExternalStore(noopSubscribe, readLastEmail, () => "");
  const [emailInput, setEmailInput] = useState<string | null>(null);
  const email = emailInput ?? storedEmail;
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState<null | "submit" | MailKind>(null);
  const [notice, setNotice] = useState<Notice>(initialNotice);
  /** Veld dat de laatste controle niet doorstond (rode rand, aria-invalid, focus). */
  const [invalid, setInvalid] = useState<Field | null>(null);
  /** Adres waarvan de bevestigingsmail nog niet is aangeklikt (na aanmelden of bij inloggen). */
  const [pendingConfirm, setPendingConfirm] = useState<string | null>(null);
  const [sent, setSent] = useState<Record<MailKind, boolean>>({ forgot: false, link: false, confirm: false });
  const cooldown = useCooldown();
  const waiting = cooldown.remaining > 0;
  const tabsRef = useRef<HTMLDivElement>(null);

  const redirectTo = () => `${window.location.origin}${safeNext}`;

  function switchMode(m: Mode) {
    setMode(m);
    setNotice(null);
    setInvalid(null);
  }

  /** Eigen controle (in het Nederlands, in onze stijl) in plaats van de browserballon. */
  function fail(field: Field, text: string) {
    setInvalid(field);
    setNotice({ kind: "error", text });
    document.getElementById(field)?.focus();
  }

  function offline() {
    if (navigator.onLine) return false;
    setNotice({ kind: "error", text: "Je bent offline. Maak verbinding met internet en probeer het opnieuw." });
    return true;
  }

  /** Mail verstuurd: knop uit tot het aftellen klaar is. */
  function mailSent(kind: MailKind) {
    setSent((s) => ({ ...s, [kind]: true }));
    cooldown.start();
  }

  /** Mislukt; zegt de server "wacht nog x seconden", dan tellen we die af. */
  function mailFailed(err: unknown) {
    const wait = retryAfterSeconds(err);
    if (wait) cooldown.start(wait);
    setNotice({ kind: "error", text: authErrorMessage(err) });
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setNotice(null);
    setInvalid(null);
    const mail = email.trim();
    if (mode === "signup" && !name.trim()) return fail("name", "Vul je naam in, zo herkennen je vrienden je.");
    if (!mail) return fail("email", "Vul je e-mailadres in.");
    if (!EMAIL_RE.test(mail)) return fail("email", "Dit lijkt geen geldig e-mailadres. Controleer het even.");
    if (mode === "login" && !password) return fail("password", "Vul je wachtwoord in.");
    if (mode === "signup" && password.length < MIN_PASSWORD) {
      return fail("password", `Kies een wachtwoord van minimaal ${MIN_PASSWORD} tekens.`);
    }
    if (mode === "forgot" && waiting) return;
    if (offline()) return;
    setBusy("submit");
    try {
      if (mode === "login") {
        const { error } = await supabase.auth.signInWithPassword({ email: mail, password });
        if (error) throw error;
        rememberEmail(mail);
        // Gelukt: AuthProvider krijgt de sessie en deze pagina stuurt door. Knop blijft "bezig".
        return;
      }
      if (mode === "forgot") {
        const { error } = await supabase.auth.resetPasswordForEmail(mail, {
          redirectTo: `${window.location.origin}/login?reset=1`,
        });
        if (error) throw error;
        rememberEmail(mail);
        mailSent("forgot");
        setNotice({
          kind: "info",
          text: `Als er een account bij ${mail} hoort, staat er nu een link in je mail. Open die op dit apparaat om een nieuw wachtwoord te kiezen. Niets ontvangen? Kijk ook in je spam.`,
        });
        setBusy(null);
        return;
      }
      const { data, error } = await supabase.auth.signUp({
        email: mail,
        password,
        options: { data: { display_name: name.trim() }, emailRedirectTo: redirectTo() },
      });
      if (error) throw error;
      rememberEmail(mail);
      // Bestaand account: Supabase geeft (bij e-mailbevestiging) geen fout maar een gebruiker zonder identiteiten.
      if (data.user && data.user.identities?.length === 0) {
        setMode("login");
        setNotice({ kind: "error", text: "Dit e-mailadres heeft al een account. Log hieronder in, of vraag een nieuw wachtwoord aan." });
      } else if (!data.session) {
        setPendingConfirm(mail);
        mailSent("confirm");
        setNotice({ kind: "info", text: `We hebben een bevestigingslink gestuurd naar ${mail}. Klik erop en je bent binnen.` });
      }
      setBusy(null);
    } catch (err) {
      if (mode === "login" && isUnconfirmed(err)) setPendingConfirm(mail);
      if (mode === "forgot") mailFailed(err);
      else setNotice({ kind: "error", text: authErrorMessage(err) });
      setBusy(null);
    }
  }

  async function sendMagicLink() {
    setNotice(null);
    const mail = email.trim();
    if (!mail || !EMAIL_RE.test(mail)) {
      fail("email", mail ? "Dit lijkt geen geldig e-mailadres. Controleer het even." : "Vul eerst je e-mailadres in, dan sturen we je een inloglink.");
      return;
    }
    if (waiting || offline()) return;
    setBusy("link");
    try {
      const { error } = await supabase.auth.signInWithOtp({
        email: mail,
        options: { shouldCreateUser: false, emailRedirectTo: redirectTo() },
      });
      if (error) throw error;
      rememberEmail(mail);
      mailSent("link");
      setNotice({ kind: "info", text: `Check je mail: met de link in het bericht naar ${mail} ben je direct ingelogd.` });
    } catch (err) {
      mailFailed(err);
    } finally {
      setBusy(null);
    }
  }

  async function resendConfirmation() {
    if (!pendingConfirm || waiting || offline()) return;
    setBusy("confirm");
    try {
      const { error } = await supabase.auth.resend({
        type: "signup",
        email: pendingConfirm,
        options: { emailRedirectTo: redirectTo() },
      });
      if (error) throw error;
      mailSent("confirm");
      setNotice({ kind: "info", text: `Nieuwe bevestigingslink verstuurd naar ${pendingConfirm}. Niets ontvangen? Kijk ook in je spam.` });
    } catch (err) {
      mailFailed(err);
    } finally {
      setBusy(null);
    }
  }

  /** Tabs met de pijltjestoetsen (ARIA-tabpatroon): alleen de actieve tab zit in de tabvolgorde. */
  function onTabKey(e: React.KeyboardEvent) {
    const keys = ["ArrowLeft", "ArrowRight", "Home", "End"];
    if (!keys.includes(e.key)) return;
    e.preventDefault();
    const next: Mode = e.key === "Home" ? "login" : e.key === "End" ? "signup" : mode === "login" ? "signup" : "login";
    if (next !== mode) switchMode(next);
    tabsRef.current?.querySelector<HTMLButtonElement>(`#tab-${next}`)?.focus();
  }

  const countdown = (label: string, kind: MailKind) =>
    waiting ? `${sent[kind] ? "Opnieuw sturen" : "Mail sturen kan"} over ${cooldown.remaining} s` : label;
  const subtitle =
    mode === "forgot" ? "Geen probleem, we sturen je een link." : mode === "signup" ? "Maak een account en train mee." : APP_TAGLINE;
  const submitLabel =
    mode === "login"
      ? "Inloggen"
      : mode === "signup"
        ? "Account maken"
        : countdown(sent.forgot ? "Stuur herstellink opnieuw" : "Stuur herstellink", "forgot");
  const submitDisabled = busy !== null || (mode === "forgot" && waiting);
  const showResend = pendingConfirm !== null && mode !== "forgot";

  return (
    <Layout subtitle={subtitle}>
      {invited && mode !== "forgot" && (
        <div
          className="animate-fade-up mb-5 flex gap-3 rounded-2xl border border-accent/30 bg-accent/10 p-3.5"
          style={{ "--i": 1 } as React.CSSProperties}
          role="note"
        >
          <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-accent/15 text-accent">
            <UsersIcon size={18} />
          </span>
          <div className="min-w-0 text-sm">
            <p className="font-semibold">Je bent uitgenodigd voor een groep</p>
            <p className="mt-0.5 text-muted">
              {mode === "signup" ? "Maak een account" : "Log in"}, dan zie je meteen welke groep het is en doe je mee.
            </p>
          </div>
        </div>
      )}

      {mode === "forgot" ? (
        <button
          type="button"
          onClick={() => switchMode("login")}
          className="animate-fade-up -ml-2 mb-4 inline-flex min-h-11 items-center gap-1 self-start rounded-lg px-2 text-sm font-medium text-muted transition-colors hover:text-ink"
        >
          <ChevronLeftIcon size={16} />
          Terug naar inloggen
        </button>
      ) : (
        <div
          ref={tabsRef}
          role="tablist"
          aria-label="Inloggen of account maken"
          onKeyDown={onTabKey}
          className="animate-fade-up relative mb-6 grid grid-cols-2 rounded-xl border border-line bg-surface p-1"
          style={{ "--i": 2 } as React.CSSProperties}
        >
          <span
            aria-hidden
            className={`absolute inset-y-1 left-1 w-[calc(50%-0.25rem)] rounded-lg bg-surface-2 shadow-sm transition-transform duration-300 ease-[cubic-bezier(0.2,0.9,0.25,1)] ${
              mode === "signup" ? "translate-x-full" : "translate-x-0"
            }`}
          />
          {(["login", "signup"] as const).map((m) => (
            <button
              key={m}
              type="button"
              role="tab"
              id={`tab-${m}`}
              aria-selected={mode === m}
              aria-controls="auth-form"
              tabIndex={mode === m ? 0 : -1}
              onClick={() => switchMode(m)}
              className={`relative min-h-11 rounded-lg py-2 text-sm font-semibold transition-colors duration-200 ${mode === m ? "text-ink" : "text-muted hover:text-ink"}`}
            >
              {m === "login" ? "Inloggen" : "Account maken"}
            </button>
          ))}
        </div>
      )}

      <form
        id="auth-form"
        role={mode === "forgot" ? undefined : "tabpanel"}
        aria-labelledby={mode === "forgot" ? undefined : `tab-${mode}`}
        onSubmit={submit}
        className="animate-fade-up space-y-4"
        style={{ "--i": 4 } as React.CSSProperties}
        noValidate
      >
        {mode === "signup" && (
          <div className="animate-fade-in">
            <label className="label" htmlFor="name">
              Naam
            </label>
            <input
              id="name"
              className="input"
              value={name}
              onChange={(e) => {
                setName(e.target.value);
                if (invalid === "name") setInvalid(null);
              }}
              required
              maxLength={40}
              autoComplete="name"
              autoCapitalize="words"
              placeholder="Hoe noemen je vrienden je?"
              aria-invalid={invalid === "name" || undefined}
              aria-describedby={invalid === "name" ? NOTICE_ID : undefined}
            />
          </div>
        )}
        <div>
          <label className="label" htmlFor="email">
            E-mail
          </label>
          <input
            id="email"
            type="email"
            inputMode="email"
            className="input"
            value={email}
            onChange={(e) => {
              setEmailInput(e.target.value);
              if (invalid === "email") setInvalid(null);
              if (pendingConfirm && e.target.value.trim() !== pendingConfirm) setPendingConfirm(null);
            }}
            required
            autoComplete={mode === "signup" ? "email" : "username"}
            autoCapitalize="none"
            autoCorrect="off"
            spellCheck={false}
            placeholder="jij@voorbeeld.nl"
            aria-invalid={invalid === "email" || undefined}
            aria-describedby={invalid === "email" ? NOTICE_ID : undefined}
          />
        </div>
        {mode !== "forgot" && (
          <div>
            <div className="flex items-end justify-between">
              <label className="label" htmlFor="password">
                Wachtwoord
              </label>
              {mode === "login" && (
                <button
                  type="button"
                  onClick={() => switchMode("forgot")}
                  // Klein ogende link met een raakvlak van 44px hoog, zonder dat de opmaak verschuift.
                  className="relative -mr-1 mb-0.5 rounded-md px-1 py-1 text-xs font-medium text-muted transition-colors after:absolute after:-inset-x-2 after:-inset-y-3 after:content-[''] hover:text-accent"
                >
                  Wachtwoord vergeten?
                </button>
              )}
            </div>
            <PasswordInput
              id="password"
              value={password}
              onChange={(e) => {
                setPassword(e.target.value);
                if (invalid === "password") setInvalid(null);
              }}
              aria-invalid={invalid === "password" || undefined}
              aria-describedby={invalid === "password" ? NOTICE_ID : undefined}
              required
              minLength={MIN_PASSWORD}
              autoComplete={mode === "login" ? "current-password" : "new-password"}
            />
            {mode === "signup" && <StrengthMeter password={password} />}
          </div>
        )}

        <div aria-live="polite" className="space-y-2 empty:hidden">
          {notice && (
            <p
              id={NOTICE_ID}
              role={notice.kind === "error" ? "alert" : "status"}
              className={`animate-fade-in flex gap-2 rounded-xl border px-3 py-2.5 text-sm ${
                notice.kind === "error"
                  ? "border-danger/30 bg-danger/10 text-danger"
                  : notice.kind === "note"
                    ? "border-line bg-surface text-ink"
                    : "border-accent/30 bg-accent/10 text-accent"
              }`}
            >
              <span className={`mt-0.5 shrink-0 ${notice.kind === "note" ? "text-accent" : ""}`}>
                {notice.kind === "error" ? <AlertIcon size={16} /> : notice.kind === "note" ? <InfoIcon size={16} /> : <CheckIcon size={16} />}
              </span>
              <span>{notice.text}</span>
            </p>
          )}
          {showResend && (
            <button
              type="button"
              className="btn-ghost animate-fade-in w-full"
              onClick={resendConfirmation}
              disabled={busy !== null || waiting}
            >
              {busy === "confirm" ? <span className="spinner" aria-hidden /> : waiting ? <ClockIcon size={16} /> : <MailIcon size={16} />}
              {countdown(sent.confirm ? "Bevestigingsmail opnieuw sturen" : "Stuur bevestigingsmail", "confirm")}
            </button>
          )}
        </div>

        <button className="btn-primary w-full py-3" disabled={submitDisabled}>
          {busy === "submit" ? <span className="spinner" aria-hidden /> : mode === "forgot" && waiting ? <ClockIcon size={16} /> : null}
          {busy === "submit" ? "Even geduld…" : submitLabel}
        </button>

        {mode === "login" && (
          <>
            <div className="flex items-center gap-3 text-xs text-muted" aria-hidden>
              <span className="h-px flex-1 bg-line" />
              of
              <span className="h-px flex-1 bg-line" />
            </div>
            <button type="button" className="btn-ghost w-full py-3" onClick={sendMagicLink} disabled={busy !== null || waiting}>
              {busy === "link" ? <span className="spinner" aria-hidden /> : waiting ? <ClockIcon size={16} /> : <MailIcon size={16} />}
              {countdown(sent.link ? "Stuur inloglink opnieuw" : "Stuur me een inloglink", "link")}
            </button>
          </>
        )}
      </form>

      {mode === "signup" && (
        <p className="animate-fade-in mt-6 text-center text-xs leading-relaxed text-muted">
          Je vrienden zien je trainingen in jullie groep. Je voeding blijft altijd privé.
        </p>
      )}
    </Layout>
  );
}
