"use client";

import { useSyncExternalStore } from "react";
import { createPortal } from "react-dom";

const subscribe = () => () => {};

/** true na hydratatie; op de server en bij de eerste client-render false, zodat die gelijk zijn. */
export function useMounted() {
  return useSyncExternalStore(
    subscribe,
    () => true,
    () => false,
  );
}

/**
 * Rendert direct in <body>, los van de pagina. Nodig voor alles met `position: fixed`
 * (pop-ups, uitschuifpanelen, animaties): binnen een element met een animatie of transform
 * zou "fixed" zich aan dat element vastzetten in plaats van aan het scherm.
 */
export function Portal({ children }: { children: React.ReactNode }) {
  const mounted = useMounted();
  if (!mounted) return null;
  return createPortal(children, document.body);
}
