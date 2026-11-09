/** Lijn-iconen (24×24, currentColor) zodat de app geen emoji's nodig heeft. */

type Props = { size?: number; className?: string; strokeWidth?: number };

function Svg({ size = 18, className, strokeWidth = 2, children }: Props & { children: React.ReactNode }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={strokeWidth}
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
      aria-hidden
    >
      {children}
    </svg>
  );
}

export const SparkleIcon = (p: Props) => (
  <Svg {...p}>
    <path d="M12 3l1.8 4.2L18 9l-4.2 1.8L12 15l-1.8-4.2L6 9l4.2-1.8z" />
    <path d="M18.5 15l.8 1.7 1.7.8-1.7.8-.8 1.7-.8-1.7-1.7-.8 1.7-.8z" />
  </Svg>
);
export const ChatIcon = (p: Props) => (
  <Svg {...p}>
    <path d="M21 12a8 8 0 01-11.6 7.1L4 20l1-4.4A8 8 0 1121 12z" />
  </Svg>
);
export const CheckIcon = (p: Props) => (
  <Svg {...p}>
    <path d="M5 12.5l4.5 4.5L19 7.5" />
  </Svg>
);
export const CloseIcon = (p: Props) => (
  <Svg {...p}>
    <path d="M6 6l12 12M18 6L6 18" />
  </Svg>
);
export const PlusIcon = (p: Props) => (
  <Svg {...p}>
    <path d="M12 5v14M5 12h14" />
  </Svg>
);
export const ArrowUpIcon = (p: Props) => (
  <Svg {...p}>
    <path d="M12 19V5M6 11l6-6 6 6" />
  </Svg>
);
export const ArrowDownIcon = (p: Props) => (
  <Svg {...p}>
    <path d="M12 5v14M6 13l6 6 6-6" />
  </Svg>
);
export const ChevronRightIcon = (p: Props) => (
  <Svg {...p}>
    <path d="M9 6l6 6-6 6" />
  </Svg>
);
export const ExternalIcon = (p: Props) => (
  <Svg {...p}>
    <path d="M14 4h6v6M20 4l-9 9M18 14v5a1 1 0 01-1 1H5a1 1 0 01-1-1V7a1 1 0 011-1h5" />
  </Svg>
);
export const PlayIcon = (p: Props) => (
  <Svg {...p}>
    <path d="M7 5l12 7-12 7z" fill="currentColor" stroke="none" />
  </Svg>
);
export const TrophyIcon = (p: Props) => (
  <Svg {...p}>
    <path d="M8 4h8v5a4 4 0 01-8 0zM8 6H5a3 3 0 003 4M16 6h3a3 3 0 01-3 4M12 13v4M8 20h8M10 17h4" />
  </Svg>
);
export const DumbbellIcon = (p: Props) => (
  <Svg {...p}>
    <path d="M6.5 6.5v11M17.5 6.5v11M3 9v6M21 9v6M6.5 12h11" />
  </Svg>
);
export const UsersIcon = (p: Props) => (
  <Svg {...p}>
    <circle cx="9" cy="8" r="3.5" />
    <path d="M2.5 20c0-3.6 2.9-5.5 6.5-5.5s6.5 1.9 6.5 5.5M16 4.6a3.5 3.5 0 010 6.8M18 14.8c2.2.6 3.5 2.3 3.5 5.2" />
  </Svg>
);
export const UserPlusIcon = (p: Props) => (
  <Svg {...p}>
    <circle cx="10" cy="8" r="3.5" />
    <path d="M3.5 20c0-3.6 2.9-5.5 6.5-5.5 1.6 0 3 .4 4.1 1.1M19 14v6M16 17h6" />
  </Svg>
);
export const CalendarIcon = (p: Props) => (
  <Svg {...p}>
    <rect x="3.5" y="5" width="17" height="15.5" rx="2.5" />
    <path d="M3.5 10h17M8 3v4M16 3v4" />
  </Svg>
);
export const BookIcon = (p: Props) => (
  <Svg {...p}>
    <path d="M4 5.5A2.5 2.5 0 016.5 3H20v15H6.5A2.5 2.5 0 004 20.5zM4 20.5A2.5 2.5 0 006.5 23H20v-5" />
  </Svg>
);
export const ClipboardIcon = (p: Props) => (
  <Svg {...p}>
    <rect x="5" y="4" width="14" height="17" rx="2.5" />
    <path d="M9 4h6v3H9zM9 12h6M9 16h4" />
  </Svg>
);
export const FlameIcon = (p: Props) => (
  <Svg {...p}>
    <path d="M12 3c1 3.5 5 5.5 5 10a5 5 0 01-10 0c0-2 1-3.5 2-4.5 0 2 1 3 2 3 0-3-1-5.5 1-8.5z" />
  </Svg>
);
export const ShareIcon = (p: Props) => (
  <Svg {...p}>
    <path d="M12 3v12M7.5 7.5L12 3l4.5 4.5M5 12v7a2 2 0 002 2h10a2 2 0 002-2v-7" />
  </Svg>
);
export const ChevronLeftIcon = (p: Props) => (
  <Svg {...p}>
    <path d="M15 18l-6-6 6-6" />
  </Svg>
);
export const EyeIcon = (p: Props) => (
  <Svg {...p}>
    <path d="M2.5 12S6 5.5 12 5.5 21.5 12 21.5 12 18 18.5 12 18.5 2.5 12 2.5 12z" />
    <circle cx="12" cy="12" r="3" />
  </Svg>
);
export const EyeOffIcon = (p: Props) => (
  <Svg {...p}>
    <path d="M10.6 5.6A9.7 9.7 0 0112 5.5c6 0 9.5 6.5 9.5 6.5a17 17 0 01-2.6 3.4M6.6 6.6C4 8.3 2.5 12 2.5 12S6 18.5 12 18.5c1.9 0 3.5-.6 4.9-1.5M9.9 9.9a3 3 0 004.2 4.2M3 3l18 18" />
  </Svg>
);
export const MailIcon = (p: Props) => (
  <Svg {...p}>
    <rect x="3" y="5" width="18" height="14" rx="2.5" />
    <path d="M3.5 7l8.5 6 8.5-6" />
  </Svg>
);
export const LockIcon = (p: Props) => (
  <Svg {...p}>
    <rect x="4.5" y="10.5" width="15" height="10" rx="2.5" />
    <path d="M8 10.5V7.5a4 4 0 018 0v3" />
  </Svg>
);
export const AlertIcon = (p: Props) => (
  <Svg {...p}>
    <circle cx="12" cy="12" r="9" />
    <path d="M12 7.5v5.5M12 16.5h.01" />
  </Svg>
);
export const RefreshIcon = (p: Props) => (
  <Svg {...p}>
    <path d="M20 11a8 8 0 00-14.6-4.5M4 4v4h4M4 13a8 8 0 0014.6 4.5M20 20v-4h-4" />
  </Svg>
);
/** Om de beurt: rondgaan langs de personen (anders dan RefreshIcon, dat "opnieuw proberen" is). */
export const TurnsIcon = (p: Props) => (
  <Svg {...p}>
    <path d="M17 3l3 3-3 3M4 11V9a3 3 0 013-3h13M7 21l-3-3 3-3M20 13v2a3 3 0 01-3 3H4" />
  </Svg>
);
export const LogOutIcon = (p: Props) => (
  <Svg {...p}>
    <path d="M14 4h4a2 2 0 012 2v12a2 2 0 01-2 2h-4M9 16l-4-4 4-4M5 12h11" />
  </Svg>
);
export const WifiOffIcon = (p: Props) => (
  <Svg {...p}>
    <path d="M3 3l18 18M8.5 16.5a5 5 0 017 0M5 12.9a10 10 0 015.2-2.7M19 12.9a10 10 0 00-2.4-1.6M2 9.3A15 15 0 016.6 6.5M22 9.3A15 15 0 0011.5 5M12 20h.01" />
  </Svg>
);
export const ClockIcon = (p: Props) => (
  <Svg {...p}>
    <circle cx="12" cy="12" r="9" />
    <path d="M12 7.5V12l3 2" />
  </Svg>
);
export const InfoIcon = (p: Props) => (
  <Svg {...p}>
    <circle cx="12" cy="12" r="9" />
    <path d="M12 11v5.5M12 7.5h.01" />
  </Svg>
);
/** Het iOS-deelicoon (vierkant met pijl omhoog), voor "Zet op beginscherm"-uitleg. */
export const ShareIosIcon = (p: Props) => (
  <Svg {...p}>
    <path d="M12 3v12M8 7l4-4 4 4" />
    <path d="M7 10H6a2 2 0 00-2 2v7a2 2 0 002 2h12a2 2 0 002-2v-7a2 2 0 00-2-2h-1" />
  </Svg>
);
export const DownloadIcon = (p: Props) => (
  <Svg {...p}>
    <path d="M12 4v11M7.5 10.5L12 15l4.5-4.5M5 20h14" />
  </Svg>
);
export const AddSquareIcon = (p: Props) => (
  <Svg {...p}>
    <rect x="4" y="4" width="16" height="16" rx="3.5" />
    <path d="M12 8.5v7M8.5 12h7" />
  </Svg>
);

/* ───────── Onderbalk (22 px) ───────── */
export const HomeIcon = (p: Props) => (
  <Svg {...p}>
    <path d="M3 10.5L12 3l9 7.5V20a1 1 0 01-1 1h-5v-6h-6v6H4a1 1 0 01-1-1z" />
  </Svg>
);
export const FoodIcon = (p: Props) => (
  <Svg {...p}>
    <path d="M7 3v8a2 2 0 01-2 2v8M3 3v6a2 2 0 002 2M7 3v6M17 21v-8c-2 0-3-2-3-5s1-5 3-5v18" />
  </Svg>
);
export const ChartIcon = (p: Props) => (
  <Svg {...p}>
    <path d="M4 20V10M10 20V4M16 20v-7M22 20H2" />
  </Svg>
);
/** Oefeningenbibliotheek: boek met een regel tekst op de kaft. */
export const LibraryIcon = (p: Props) => (
  <Svg {...p}>
    <path d="M4 5.5A2.5 2.5 0 016.5 3H20v14.5H6.5A2.5 2.5 0 004 20zM4 20a2.5 2.5 0 002.5 2H20v-4.5" />
    <path d="M9 7.5h6" />
  </Svg>
);
/** Schema's: blad met regels. */
export const ListIcon = (p: Props) => (
  <Svg {...p}>
    <rect x="4" y="3.5" width="16" height="17" rx="2.5" />
    <path d="M8.5 8.5h7M8.5 12h7M8.5 15.5h4" />
  </Svg>
);
