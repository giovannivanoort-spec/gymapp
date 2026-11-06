/** Lijn-iconen voor slaap (24×24, currentColor), in dezelfde stijl als components/Icons. */

type Props = { size?: number; className?: string; strokeWidth?: number };

/** Maansikkel. */
export const MoonIcon = ({ size = 18, className, strokeWidth = 2 }: Props) => (
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
    <path d="M20.5 14.2A8.5 8.5 0 0 1 9.8 3.5a8.5 8.5 0 1 0 10.7 10.7Z" />
  </svg>
);
