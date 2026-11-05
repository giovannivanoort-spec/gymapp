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
