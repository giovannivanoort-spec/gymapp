"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useEffect } from "react";
import { invalidate, useCached } from "@/lib/cache";
import { useFriends, useFriendsRealtime } from "@/lib/friends";
import { fetchMyGroups, myGroupsKey, type MyGroup } from "@/lib/groups";
import { useAuth } from "./AuthProvider";
import { ProfileButton } from "./Avatar";
import { ChartIcon, ChevronLeftIcon, FoodIcon, HomeIcon, LibraryIcon, ListIcon } from "./Icons";
import { NewWorkoutButton } from "./NewWorkoutButton";
import { InstallHint } from "./shell/InstallHint";

/*
 * Aantal navigaties binnen de app sinds het openen. Is dat 0 (koud geopend via een melding,
 * gedeelde link of opnieuw gestarte PWA), dan is er geen vorige pagina in de app en zou
 * "terug" niets doen of de app verlaten.
 */
let inAppNavigations = 0;
let lastPath: string | null = null;
/** Pad van de pagina hiervoor (voor een terugknop met vast doel: is dat de vorige pagina, dan echt terug). */
let previousPath: string | null = null;
/** Volgende padwissel is een stap terug (telt dan af in plaats van op). */
let goingBack = false;
/** Volgende padwissel vervangt de huidige pagina in de geschiedenis (telt niet mee). */
let replacing = false;

/*
 * Terug via het systeem (Android-terugknop, veeggebaar in Safari) moet ook aftellen, anders loopt
 * de teller op en kan de terugknop in de app de app verlaten. Eén keer registreren, op module-niveau.
 */
type NavApi = {
  canGoBack?: boolean;
  currentEntry?: { index: number } | null;
  addEventListener?: (type: "navigate", fn: (e: { navigationType: string; destination: { index: number } }) => void) => void;
};
if (typeof window !== "undefined") {
  const nav = (window as Window & { navigation?: NavApi }).navigation;
  if (nav?.addEventListener) {
    nav.addEventListener("navigate", (e) => {
      if (e.navigationType !== "traverse") return;
      const from = nav.currentEntry?.index ?? -1;
      goingBack = e.destination.index >= 0 && from >= 0 ? e.destination.index < from : true;
    });
  } else {
    window.addEventListener("popstate", () => {
      goingBack = true;
    });
  }
}

function canGoBackInApp(): boolean {
  const nav = (window as Window & { navigation?: { canGoBack?: boolean } }).navigation;
  if (nav && typeof nav.canGoBack === "boolean") return nav.canGoBack && inAppNavigations > 0;
  return inAppNavigations > 0 && window.history.length > 1;
}

type NavItem = { href: string; label: string; icon: (p: { size?: number }) => React.ReactNode };

const HOME: NavItem = { href: "/", label: "Home", icon: HomeIcon };
const FOOD: NavItem = { href: "/nutrition", label: "Voeding", icon: FoodIcon };
const PROGRESS: NavItem = { href: "/progress", label: "Progressie", icon: ChartIcon };
const TEMPLATES: NavItem = { href: "/templates", label: "Schema's", icon: ListIcon };
const EXERCISES: NavItem = { href: "/exercises", label: "Oefeningen", icon: LibraryIcon };

function isActive(href: string, pathname: string) {
  if (href === "/") return pathname === "/";
  return pathname === href || pathname.startsWith(`${href}/`);
}

/**
 * Rol in de groepen: trainers plannen (plusknop maakt een training, laatste tab is Schema's),
 * leden niet (plusknop toont de training van vandaag, laatste tab is Oefeningen).
 * Zolang het nog onbekend is gedragen we ons als trainer, zodat de balk niet verspringt voor wie dat is.
 */
function useNavRole(userId: string | undefined): "trainer" | "member" | "unknown" {
  const groups = useCached<MyGroup[]>(userId ? myGroupsKey(userId) : null, () => fetchMyGroups(userId ?? ""), {
    persist: true,
    maxAge: 60_000,
  });
  if (!groups) return "unknown";
  if (groups.some((g) => g.role === "trainer")) return "trainer";
  return groups.length > 0 ? "member" : "unknown";
}

type Props = {
  title?: string;
  /** Toon een terugknop in plaats van alleen de titel. */
  back?: boolean | string;
  action?: React.ReactNode;
  children: React.ReactNode;
};

export function AppShell({ title, back, action, children }: Props) {
  const pathname = usePathname();
  const router = useRouter();
  const { session, profile } = useAuth();

  useEffect(() => {
    if (lastPath !== null && lastPath !== pathname) {
      if (goingBack) inAppNavigations = Math.max(0, inAppNavigations - 1);
      else if (!replacing) inAppNavigations++;
      goingBack = false;
      replacing = false;
      previousPath = lastPath;
      // Net een training verlaten: of je begonnen bent (stip op de plusknop) opnieuw bekijken.
      if (lastPath.startsWith("/workouts/")) invalidate("shell:today:");
    }
    lastPath = pathname;
  }, [pathname]);

  const userId = session?.user.id ?? null;
  const profileName = profile?.display_name || String(session?.user.user_metadata?.display_name ?? "");
  const role = useNavRole(session?.user.id);
  // Vriendschapsverzoeken live binnen op elke pagina, met een teller op je avatar.
  useFriendsRealtime(userId);
  const requests = useFriends(userId)?.incoming.length ?? 0;
  const nav: (NavItem | null)[] = [HOME, FOOD, null, PROGRESS, role === "member" ? EXERCISES : TEMPLATES];

  function goBack() {
    const inApp = canGoBackInApp();
    // Vast doel dat ook de vorige pagina is: echt terug, zodat de systeem-terugknop daarna klopt.
    if (typeof back === "string" && !(inApp && previousPath === back.split(/[?#]/)[0])) {
      // Anders vervangen in plaats van toevoegen: geen extra stap die je weer naar dit scherm brengt.
      replacing = true;
      router.replace(back);
    } else if (inApp) {
      goingBack = true;
      router.back();
    } else {
      replacing = true;
      router.replace("/");
    }
  }

  return (
    <div className="mx-auto flex min-h-dvh max-w-2xl flex-col">
      {title !== undefined && (
        <header className="sticky top-0 z-(--z-header) flex items-center gap-2 border-b border-line bg-bg/90 px-4 pb-3 pt-[max(0.75rem,env(safe-area-inset-top))] backdrop-blur">
          {back && (
            <button
              type="button"
              onClick={goBack}
              className="-my-1.5 -ml-3 flex h-11 w-11 shrink-0 items-center justify-center rounded-xl text-muted transition-colors hover:bg-surface-2 hover:text-ink active:scale-95"
              aria-label="Terug"
            >
              <ChevronLeftIcon size={22} strokeWidth={2.2} />
            </button>
          )}
          <h1 className="min-w-0 flex-1 truncate text-lg font-bold">{title}</h1>
          {action}
          {session &&
            !pathname.startsWith("/profile") &&
            (profileName ? (
              <ProfileButton id={session.user.id} name={profileName} badge={requests} />
            ) : (
              <span className="-my-1.5 -mr-1.5 flex h-11 w-11 shrink-0 items-center justify-center" aria-hidden>
                <span className="skeleton h-[34px] w-[34px] rounded-full" />
              </span>
            ))}
        </header>
      )}

      <main key={pathname} className="animate-fade-up flex-1 px-4 pt-4 pb-[calc(env(safe-area-inset-bottom)+7rem)]">
        {pathname === "/" && session && (
          // Home heeft geen kopbalk en zet zelf de safe area bovenaan; de hint schuift daar netjes tussen.
          <div className="-mb-[env(safe-area-inset-top)] pt-[env(safe-area-inset-top)] empty:hidden">
            <InstallHint />
          </div>
        )}
        {children}
      </main>

      <nav
        aria-label="Hoofdmenu"
        className="fixed inset-x-0 bottom-0 z-(--z-nav) border-t border-line bg-bg/90 pb-[env(safe-area-inset-bottom)] backdrop-blur-xl"
      >
        <div className="mx-auto grid max-w-2xl grid-cols-5">
          {nav.map((item) => {
            if (!item) return session ? <NewWorkoutButton key="new" member={role === "member"} /> : <span key="new" />;
            const { href, label, icon: Icon } = item;
            const active = isActive(href, pathname);
            return (
              <Link
                key={href}
                href={href}
                aria-current={active ? "page" : undefined}
                className={`group relative flex min-h-[var(--nav-h)] flex-col items-center justify-center gap-1 py-2 text-xs font-medium transition-colors duration-200 ${
                  active ? "text-accent" : "text-muted hover:text-ink"
                }`}
              >
                <span
                  className={`absolute top-0 h-0.5 rounded-full bg-accent transition-all duration-300 ${active ? "w-8 opacity-100" : "w-0 opacity-0"}`}
                />
                <span className={`transition-transform duration-200 ${active ? "-translate-y-0.5 scale-110" : "group-active:scale-90"}`}>
                  <Icon size={22} />
                </span>
                {label}
              </Link>
            );
          })}
        </div>
      </nav>
    </div>
  );
}
