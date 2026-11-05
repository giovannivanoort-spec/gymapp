"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useAuth } from "./AuthProvider";
import { ProfileButton } from "./Avatar";
import { NewWorkoutButton } from "./NewWorkoutButton";

const NAV = [
  { href: "/", label: "Home", icon: HomeIcon },
  { href: "/nutrition", label: "Voeding", icon: FoodIcon },
  null,
  { href: "/progress", label: "Progressie", icon: ChartIcon },
  { href: "/templates", label: "Schema's", icon: ListIcon },
];

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

  return (
    <div className="mx-auto flex min-h-dvh max-w-2xl flex-col">
      {title !== undefined && (
        <header className="sticky top-0 z-20 flex items-center gap-2 border-b border-line bg-bg/90 px-4 pb-3 pt-[max(0.75rem,env(safe-area-inset-top))] backdrop-blur">
          {back && (
            <button
              onClick={() => (typeof back === "string" ? router.push(back) : router.back())}
              className="-ml-2 rounded-lg p-2 text-muted hover:text-ink"
              aria-label="Terug"
            >
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2">
                <path d="M15 18l-6-6 6-6" strokeLinecap="round" strokeLinejoin="round" />
              </svg>
            </button>
          )}
          <h1 className="min-w-0 flex-1 truncate text-lg font-bold">{title}</h1>
          {action}
          {session && !pathname.startsWith("/profile") && (
            <ProfileButton id={session.user.id} name={profile?.display_name ?? ""} />
          )}
        </header>
      )}

      <main key={pathname} className="animate-fade-up flex-1 px-4 pt-4 pb-[calc(env(safe-area-inset-bottom)+7rem)]">
        {children}
      </main>

      <nav className="fixed inset-x-0 bottom-0 z-30 border-t border-line bg-bg/90 pb-[env(safe-area-inset-bottom)] backdrop-blur-xl">
        <div className="mx-auto grid max-w-2xl grid-cols-5">
          {NAV.map((item) => {
            if (!item) return session ? <NewWorkoutButton key="new" /> : <span key="new" />;
            const { href, label, icon: Icon } = item;
            const active = href === "/" ? pathname === "/" : pathname.startsWith(href);
            return (
              <Link
                key={href}
                href={href}
                className={`group relative flex flex-col items-center gap-1 py-2.5 text-[11px] font-medium transition-colors duration-200 ${
                  active ? "text-accent" : "text-muted hover:text-ink"
                }`}
              >
                <span
                  className={`absolute top-0 h-0.5 rounded-full bg-accent transition-all duration-300 ${active ? "w-8 opacity-100" : "w-0 opacity-0"}`}
                />
                <span className={`transition-transform duration-200 ${active ? "-translate-y-0.5 scale-110" : "group-active:scale-90"}`}>
                  <Icon />
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

const iconProps = {
  width: 22,
  height: 22,
  viewBox: "0 0 24 24",
  fill: "none",
  stroke: "currentColor",
  strokeWidth: 2,
  strokeLinecap: "round" as const,
  strokeLinejoin: "round" as const,
};

function HomeIcon() {
  return (
    <svg {...iconProps}>
      <path d="M3 10.5L12 3l9 7.5V20a1 1 0 01-1 1h-5v-6h-6v6H4a1 1 0 01-1-1z" />
    </svg>
  );
}
function FoodIcon() {
  return (
    <svg {...iconProps}>
      <path d="M7 3v8a2 2 0 01-2 2v8M3 3v6a2 2 0 002 2M7 3v6M17 21v-8c-2 0-3-2-3-5s1-5 3-5v18" />
    </svg>
  );
}
function ChartIcon() {
  return (
    <svg {...iconProps}>
      <path d="M4 20V10M10 20V4M16 20v-7M22 20H2" />
    </svg>
  );
}
function ListIcon() {
  return (
    <svg {...iconProps}>
      <rect x="4" y="3.5" width="16" height="17" rx="2.5" />
      <path d="M8.5 8.5h7M8.5 12h7M8.5 15.5h4" />
    </svg>
  );
}
