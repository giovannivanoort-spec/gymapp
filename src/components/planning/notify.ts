"use client";

import { toast, type ToastAction } from "../ui/Toast";

/**
 * Meldingen van het planningsdeel via het gedeelde meldingensysteem (components/ui/Toast).
 * Meldingen met een actie ("Ongedaan maken") blijven 7 seconden staan, zodat je ze midden in
 * een training niet mist.
 */
export function notify(text: string, opts: { action?: ToastAction; tone?: "ok" | "error" | "info"; ms?: number } = {}) {
  const tone = opts.tone === "error" ? "error" : opts.tone === "info" ? "info" : "success";
  return toast(text, { action: opts.action, tone, duration: opts.ms ?? (opts.action ? 7000 : undefined) });
}
