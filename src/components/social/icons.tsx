/** Extra lijn-iconen voor vrienden en profiel (zelfde stijl als components/Icons). */

type Props = { size?: number; className?: string };

function Svg({ size = 18, className, children }: Props & { children: React.ReactNode }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={2}
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
      aria-hidden
    >
      {children}
    </svg>
  );
}

export const CopyIcon = (p: Props) => (
  <Svg {...p}>
    <rect x="9" y="9" width="11" height="11" rx="2.5" />
    <path d="M5 15V6.5A2.5 2.5 0 017.5 4H15" />
  </Svg>
);

export const QrIcon = (p: Props) => (
  <Svg {...p}>
    <rect x="4" y="4" width="6" height="6" rx="1" />
    <rect x="14" y="4" width="6" height="6" rx="1" />
    <rect x="4" y="14" width="6" height="6" rx="1" />
    <path d="M14 14h2v2h-2zM18 18h2v2h-2zM14 18h2M18 14h2" />
  </Svg>
);

export const LogoutIcon = (p: Props) => (
  <Svg {...p}>
    <path d="M15 4h3a2 2 0 012 2v12a2 2 0 01-2 2h-3" />
    <path d="M10 16l-4-4 4-4M6 12h10" />
  </Svg>
);

export const RetryIcon = (p: Props) => (
  <Svg {...p}>
    <path d="M20 11a8 8 0 10-2.3 5.7" />
    <path d="M20 4v7h-7" />
  </Svg>
);

export const ProgressIcon = (p: Props) => (
  <Svg {...p}>
    <path d="M4 19h16M6 15l4-4 3 3 5-6" />
  </Svg>
);

export const KeyIcon = (p: Props) => (
  <Svg {...p}>
    <circle cx="8" cy="15" r="4" />
    <path d="M10.8 12.2L20 3M16 7l3 3M14 9l2 2" />
  </Svg>
);

export const PhoneIcon = (p: Props) => (
  <Svg {...p}>
    <rect x="7" y="3" width="10" height="18" rx="2.5" />
    <path d="M11 18h2" />
  </Svg>
);

export const CameraIcon = (p: Props) => (
  <Svg {...p}>
    <path d="M4 8.5A1.5 1.5 0 015.5 7h2l1.6-2.2h5.8L16.5 7h2A1.5 1.5 0 0120 8.5v9a1.5 1.5 0 01-1.5 1.5h-13A1.5 1.5 0 014 17.5z" />
    <circle cx="12" cy="13" r="3.5" />
  </Svg>
);

export const TrashIcon = (p: Props) => (
  <Svg {...p}>
    <path d="M4 7h16M9 7V4h6v3M6 7l1 13h10l1-13M10 11v6M14 11v6" />
  </Svg>
);
