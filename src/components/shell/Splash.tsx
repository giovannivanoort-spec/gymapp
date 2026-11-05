import Image from "next/image";
import { APP_NAME } from "@/lib/brand";

/**
 * Startscherm: logo met een rustige "ademende" gloed. Eén component voor de Suspense-fallback
 * en het laden van de sessie, zodat een koude start niet tussen twee schermen flitst.
 * Met `children` (bijv. een melding met knoppen) eronder.
 */
export function Splash({ children, label = "Laden" }: { children?: React.ReactNode; label?: string }) {
  return (
    <div
      className="flex min-h-dvh flex-col items-center justify-center px-6 pb-[env(safe-area-inset-bottom)] pt-[env(safe-area-inset-top)]"
      role="status"
      aria-live="polite"
    >
      <div className="relative">
        <span aria-hidden className="animate-splash-glow absolute inset-0 rounded-[22px] bg-accent/25 blur-xl" />
        <Image src="/icon.svg" alt="" width={64} height={64} className="relative rounded-[18px]" priority />
      </div>
      <p className="mt-4 text-sm font-semibold tracking-wide text-muted">{APP_NAME}</p>
      <span className="sr-only">{label}</span>
      {children && <div className="animate-fade-up mt-8 w-full max-w-xs text-center">{children}</div>}
    </div>
  );
}
