"use client";

import type { Session } from "@supabase/supabase-js";
import { usePathname, useRouter } from "next/navigation";
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from "react";
import { clearCache, getCached, setCached } from "@/lib/cache";
import { fetchOwnProfile, supabase, supabaseConfigured } from "@/lib/supabase";
import type { Profile } from "@/lib/types";
import { LogOutIcon, RefreshIcon } from "./Icons";
import { OfflineSync } from "./OfflineSync";
import { SetupNotice } from "./SetupNotice";
import { ServiceWorkerBridge } from "./platform/ServiceWorkerBridge";
import { Splash } from "./shell/Splash";
import { useOffline } from "./ui/States";
import { Toaster } from "./ui/Toast";

type AuthState = {
  session: Session | null;
  profile: Profile | null;
  loading: boolean;
  refreshProfile: () => Promise<void>;
};

const AuthContext = createContext<AuthState>({
  session: null,
  profile: null,
  loading: true,
  refreshProfile: async () => {},
});

/** Pagina's die zonder inloggen te zien zijn (zonder navigatie). /privacy moet openbaar blijven (winkels). */
const PUBLIC_PATHS = ["/login", "/privacy"];
/** Na zoveel ms laden bieden we "opnieuw proberen" en "uitloggen" aan in plaats van eindeloos te wachten. */
const SLOW_AFTER_MS = 8000;
/** Pad van het scherm voor een nieuw wachtwoord (na de link uit de herstelmail). */
export const RESET_PATH = "/login?reset=1";

/*
 * Herstellink uit de mail: Supabase leest de tokens uit de URL en wist die daarna. We kijken
 * meteen bij het laden van deze module, zodat we het ook weten als de link (bij een niet
 * toegestane redirect) op de startpagina uitkomt in plaats van op /login?reset=1.
 */
const RECOVERY_IN_URL = typeof window !== "undefined" && /(?:^#|&)type=recovery(?:&|$)/.test(window.location.hash);

/**
 * Fout uit een verlopen of al gebruikte maillink (Supabase zet die in de hash, bijv.
 * `#error=access_denied&error_code=otp_expired`). Komt de link op een beschermde pagina uit
 * (de Site URL "/"), dan verdwijnt de hash bij het doorsturen naar /login. Daarom lezen we hem
 * hier bij het laden en geven hem eenmalig mee als `?link=verlopen` (of `?link=ongeldig`).
 */
let pendingLinkError: LinkError | null = typeof window !== "undefined" ? linkErrorFromHash(window.location.hash) : null;

export type LinkError = "verlopen" | "ongeldig";

/** Soort fout uit een maillink in de hash, of null als er geen fout in staat. */
export function linkErrorFromHash(hash: string): LinkError | null {
  if (!hash.includes("error")) return null;
  const params = new URLSearchParams(hash.replace(/^#/, ""));
  const code = params.get("error_code") ?? params.get("error") ?? "";
  if (!code) return null;
  return code === "otp_expired" || code === "access_denied" ? "verlopen" : "ongeldig";
}

/**
 * Bewust uitgelogd via signOut(). Een SIGNED_OUT zonder deze vlag is onvrijwillig (sessie verlopen
 * of ingetrokken): dan sturen we je na het inloggen terug naar waar je was.
 */
let voluntarySignOut = false;
/** Zelfde vlag voor andere tabbladen: uitloggen daar is ook bewust, geen verlopen sessie. */
const SIGN_OUT_KEY = "spotter:signed-out-at";

function markVoluntarySignOut() {
  voluntarySignOut = true;
  try {
    window.localStorage.setItem(SIGN_OUT_KEY, String(Date.now()));
  } catch {
    // geen opslag: dan geldt het alleen voor dit tabblad
  }
}

/** Is er (in dit of een ander tabblad) zojuist bewust uitgelogd? */
function wasVoluntarySignOut(): boolean {
  if (voluntarySignOut) return true;
  try {
    const at = Number(window.localStorage.getItem(SIGN_OUT_KEY) ?? 0);
    return at > 0 && Date.now() - at < 15_000;
  } catch {
    return false;
  }
}

/**
 * Uitloggen dat ook zonder verbinding werkt: lukt het niet bij de server, dan in elk geval op
 * dit apparaat. Wist daarna alle bewaarde data, zodat een volgende gebruiker niets van jou ziet.
 */
export async function signOut() {
  markVoluntarySignOut();
  try {
    const { error } = await supabase.auth.signOut();
    if (error) await supabase.auth.signOut({ scope: "local" });
  } catch {
    await supabase.auth.signOut({ scope: "local" }).catch(() => {});
  }
  clearCache();
}

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [session, setSession] = useState<Session | null>(null);
  const [profile, setProfile] = useState<Profile | null>(null);
  const [loading, setLoading] = useState(true);
  const [slow, setSlow] = useState(false);
  const router = useRouter();
  const pathname = usePathname();
  /** Gebruiker waarvoor het profiel nu geldt; voorkomt dat een laat antwoord van een vorig account wint. */
  const userIdRef = useRef<string | undefined>(undefined);
  /** Bewust uitgelogd: dan niet terugsturen naar de pagina waar je was (die hoort bij het vorige account). */
  const signedOutRef = useRef(false);
  /** Sessie onderweg verlopen: op het inlogscherm uitleggen waarom je opnieuw moet inloggen. */
  const expiredRef = useRef(false);

  const loadProfile = useCallback(async (userId: string | undefined) => {
    if (!userId) {
      setProfile(null);
      return;
    }
    try {
      const data = await fetchOwnProfile(userId);
      if (userIdRef.current !== userId) return;
      if (data) setCached(`profile:${userId}`, data, true);
      setProfile(data);
    } catch {
      // Netwerk- of databasefout: het bekende (bewaarde) profiel laten staan in plaats van het te wissen.
    }
  }, []);

  useEffect(() => {
    if (!supabaseConfigured) return;
    let alive = true;
    const slowTimer = setTimeout(() => {
      if (alive) setSlow(true);
    }, SLOW_AFTER_MS);

    (async () => {
      try {
        const { data } = await supabase.auth.getSession();
        if (!alive) return;
        const s = data.session;
        const uid = s?.user.id;
        userIdRef.current = uid;
        setSession(s);
        // Bekend profiel van een vorige keer: app direct tonen en op de achtergrond verversen.
        const cached = uid ? getCached<Profile>(`profile:${uid}`) : undefined;
        if (cached) {
          setProfile(cached);
          setLoading(false);
          void loadProfile(uid);
        } else {
          await loadProfile(uid);
        }
        if (s && RECOVERY_IN_URL) router.replace(RESET_PATH);
      } catch {
        // Beschadigde opslag of netwerkfout tijdens verversen: verder als uitgelogd.
      } finally {
        if (alive) {
          clearTimeout(slowTimer);
          setLoading(false);
        }
      }
    })();

    const { data: sub } = supabase.auth.onAuthStateChange((event, s) => {
      // De eerste sessie is hierboven al afgehandeld.
      if (event === "INITIAL_SESSION") return;
      const uid = s?.user.id;
      if (event === "SIGNED_OUT") {
        const voluntary = wasVoluntarySignOut();
        signedOutRef.current = voluntary;
        expiredRef.current = !voluntary && !!userIdRef.current;
        voluntarySignOut = false;
        clearCache();
      } else if (event === "SIGNED_IN") {
        signedOutRef.current = false;
        expiredRef.current = false;
      }
      if (uid !== userIdRef.current) {
        // Ander account (of uitgelogd): nooit het profiel van de vorige gebruiker laten staan.
        userIdRef.current = uid;
        setProfile(uid ? (getCached<Profile>(`profile:${uid}`) ?? null) : null);
      }
      setSession(s);
      if (event === "PASSWORD_RECOVERY") router.replace(RESET_PATH);
      // Niet binnen deze callback op Supabase wachten (dat kan vastlopen); daarom pas daarna.
      if (event !== "TOKEN_REFRESHED") setTimeout(() => void loadProfile(uid), 0);
    });

    return () => {
      alive = false;
      clearTimeout(slowTimer);
      sub.subscription.unsubscribe();
    };
  }, [loadProfile, router]);

  const isPublic = PUBLIC_PATHS.includes(pathname);

  useEffect(() => {
    if (loading) return;
    /*
     * Fout uit een maillink: doorgeven aan het inlogscherm als ?link=. Pas vergeten als hij in de
     * URL staat (of je al ingelogd bent), zodat een dubbel uitgevoerd effect hem niet kwijtraakt.
     * Een later bezoek aan /login (bijv. na uitloggen) ziet hem dus nooit meer.
     */
    const linkError = pendingLinkError;
    const search = new URLSearchParams(window.location.search);
    if (session || (pathname === "/login" && search.has("link"))) pendingLinkError = null;
    if (session) return;
    const link = linkError ? `link=${linkError}` : "";
    if (isPublic) {
      // Al op /login met de fout in de hash: de fout als parameter (wist meteen de hash).
      if (linkError && pathname === "/login" && !search.has("link")) {
        search.set("link", linkError);
        router.replace(`/login?${search.toString()}`);
      }
      return;
    }
    // Uitloggen vanaf het profiel is altijd bewust, ook als het niet via signOut() ging.
    const keepNext = !signedOutRef.current && pathname !== "/" && !pathname.startsWith("/profile");
    if (!keepNext) {
      router.replace(link ? `/login?${link}` : "/login");
      return;
    }
    // Met de querystring erbij (bijv. ?date= of ?from=), zodat je na het inloggen precies terugkomt.
    const next = encodeURIComponent(pathname + window.location.search);
    router.replace(`/login?next=${next}${expiredRef.current ? "&expired=1" : ""}${link ? `&${link}` : ""}`);
  }, [loading, session, isPublic, pathname, router]);

  // Profiel kon niet geladen worden (offline, niets bewaard): opnieuw proberen zodra er weer verbinding is.
  useEffect(() => {
    if (profile || !session) return;
    const uid = session.user.id;
    const onOnline = () => void loadProfile(uid);
    window.addEventListener("online", onOnline);
    return () => window.removeEventListener("online", onOnline);
  }, [profile, session, loadProfile]);

  const userId = session?.user.id;
  const refreshProfile = useCallback(() => loadProfile(userId), [loadProfile, userId]);
  const value = useMemo<AuthState>(
    () => ({ session, profile, loading, refreshProfile }),
    [session, profile, loading, refreshProfile],
  );

  if (!supabaseConfigured) return <SetupNotice />;

  if (!isPublic && (loading || !session)) {
    return (
      <AuthContext.Provider value={value}>
        {loading && slow ? <SlowStart /> : <Splash />}
      </AuthContext.Provider>
    );
  }

  return (
    <AuthContext.Provider value={value}>
      {children}
      {session && (
        <>
          <OfflineSync />
          <ServiceWorkerBridge />
        </>
      )}
      <Toaster />
    </AuthContext.Provider>
  );
}

/** Laden duurt te lang (slechte verbinding, vastgelopen sessie): geef de gebruiker een uitweg. */
function SlowStart() {
  const [busy, setBusy] = useState(false);
  // Live: de tekst past zich aan als de verbinding wegvalt of terugkomt.
  const offline = useOffline();

  // Weer online na offline te zijn geweest: meteen opnieuw starten, zonder dat je hoeft te tikken.
  useEffect(() => {
    const onOnline = () => window.location.reload();
    window.addEventListener("online", onOnline);
    return () => window.removeEventListener("online", onOnline);
  }, []);

  return (
    <Splash label="Laden duurt langer dan normaal">
      <p className="text-sm font-semibold">{offline ? "Je bent offline" : "Dit duurt langer dan normaal"}</p>
      <p className="mt-1 text-sm text-muted">
        {offline
          ? "Zodra er weer verbinding is, gaat de app vanzelf verder."
          : "Controleer je verbinding. Lukt het niet, log dan opnieuw in."}
      </p>
      <div className="mt-5 grid gap-2">
        <button type="button" className="btn-primary w-full" onClick={() => window.location.reload()}>
          <RefreshIcon size={16} />
          Opnieuw proberen
        </button>
        <button
          type="button"
          className="btn-ghost w-full"
          disabled={busy}
          onClick={async () => {
            setBusy(true);
            await signOut();
            window.location.replace("/login");
          }}
        >
          {busy ? <span className="spinner" aria-hidden /> : <LogOutIcon size={16} />}
          Uitloggen
        </button>
      </div>
    </Splash>
  );
}

export function useAuth() {
  return useContext(AuthContext);
}

/** Voor pagina's achter de login: session is daar altijd gezet. */
export function useUserId(): string {
  const { session } = useAuth();
  return session?.user.id ?? "";
}
