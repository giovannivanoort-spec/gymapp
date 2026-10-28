"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";

const NAV = [
  { href: "/", label: "Home", icon: HomeIcon },
  { href: "/exercises", label: "Oefeningen", icon: BookIcon },
  { href: "/coach", label: "Coach", icon: CoachIcon },
  { href: "/progress", label: "Progressie", icon: ChartIcon },
  { href: "/profile", label: "Profiel", icon: UserIcon },
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
        </header>
      )}

      <main key={pathname} className="animate-fade-up flex-1 px-4 pb-28 pt-4">
        {children}
      </main>

      <nav className="fixed inset-x-0 bottom-0 z-30 border-t border-line bg-bg/90 pb-[env(safe-area-inset-bottom)] backdrop-blur-xl">
        <div className="mx-auto grid max-w-2xl grid-cols-5">
          {NAV.map(({ href, label, icon: Icon }) => {
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
function BookIcon() {
  return (
    <svg {...iconProps}>
      <path d="M6.5 6.5h11M6.5 17.5h11M3 9v6M21 9v6M6.5 5v14M17.5 5v14" />
    </svg>
  );
}
function CoachIcon() {
  return (
    <svg {...iconProps}>
      <path d="M12 3l1.8 4.2L18 9l-4.2 1.8L12 15l-1.8-4.2L6 9l4.2-1.8z" />
      <path d="M18.5 15l.8 1.7 1.7.8-1.7.8-.8 1.7-.8-1.7-1.7-.8 1.7-.8z" />
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
function UserIcon() {
  return (
    <svg {...iconProps}>
      <circle cx="12" cy="8" r="4" />
      <path d="M4 21c0-4 4-6 8-6s8 2 8 6" />
    </svg>
  );
}
