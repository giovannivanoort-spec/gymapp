"use client";

import { createPortal } from "react-dom";

/**
 * Rendert direct in <body>, los van de pagina. Nodig voor alles met `position: fixed`
 * (pop-ups, uitschuifpanelen, animaties): binnen een element met een animatie of transform
 * zou "fixed" zich aan dat element vastzetten in plaats van aan het scherm.
 */
export function Portal({ children }: { children: React.ReactNode }) {
  if (typeof document === "undefined") return null;
  return createPortal(children, document.body);
}
