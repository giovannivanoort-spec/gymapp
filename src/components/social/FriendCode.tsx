"use client";

import { useEffect, useRef, useState } from "react";
import { ShareIcon } from "../Icons";
import { Sheet } from "../Sheet";
import { toast } from "../ui/Toast";
import { copyText, friendLink, shareFriendLink } from "@/lib/friends";
import { FriendQR } from "./FriendQR";
import { CopyIcon, QrIcon } from "./icons";

export type Flash = { text: string; error?: boolean };

/** Een melding als toast onderin beeld (fout of bevestiging). */
export function showFlashToast(m: Flash) {
  if (m.error) toast.error(m.text);
  else toast.success(m.text);
}

/** Korte melding die na een paar seconden vanzelf verdwijnt. */
export function useFlash(ms = 2600, initial: Flash | null = null) {
  const [flash, setFlash] = useState<Flash | null>(initial);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const startedWith = useRef(initial !== null);
  useEffect(() => {
    // Een beginmelding (bijv. na wegnavigeren) verdwijnt net als elke andere vanzelf.
    if (startedWith.current) timer.current = setTimeout(() => setFlash(null), ms);
    return () => {
      if (timer.current) clearTimeout(timer.current);
    };
    // Alleen bij het eerste renderen.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  function show(next: Flash | null) {
    if (timer.current) clearTimeout(timer.current);
    setFlash(next);
    if (next) timer.current = setTimeout(() => setFlash(null), ms);
  }
  return [flash, show] as const;
}

/**
 * Jouw vriendcode: tik op de code om te kopiëren, deel de link of toon een QR-code om te scannen.
 * `onMessage` krijgt meldingen (gekopieerd / mislukt) als de ouder ze zelf wil tonen.
 */
export function FriendCode({ code, onMessage }: { code: string | undefined; onMessage?: (m: Flash) => void }) {
  const [copied, setCopied] = useState(false);
  const [qr, setQr] = useState(false);
  const copiedTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [flash, showFlash] = useFlash();
  const notify = (m: Flash) => (onMessage ? onMessage(m) : showFlash(m));

  useEffect(() => () => {
    if (copiedTimer.current) clearTimeout(copiedTimer.current);
  }, []);

  async function copy() {
    if (!code) return;
    if (await copyText(code)) {
      setCopied(true);
      if (copiedTimer.current) clearTimeout(copiedTimer.current);
      copiedTimer.current = setTimeout(() => setCopied(false), 1600);
    } else {
      notify({ text: "Kopiëren lukte niet. Selecteer de code en kopieer hem zelf.", error: true });
    }
  }

  async function share() {
    if (!code) return;
    const res = await shareFriendLink(code);
    if (res === "copied") notify({ text: "Link gekopieerd. Plak hem in een chat met je vriend." });
    if (res === "failed") notify({ text: `Kopiëren lukte niet. Je link: ${friendLink(code)}`, error: true });
  }

  return (
    <>
      <div className="flex items-center gap-2 rounded-xl border border-line bg-surface-2 p-1.5 pl-1.5">
        <button
          type="button"
          onClick={copy}
          disabled={!code}
          className="group min-w-0 flex-1 rounded-lg px-1.5 py-0.5 text-left transition hover:bg-surface active:scale-[0.98]"
          aria-label={code ? `Jouw vriendcode ${code.split("").join(" ")}, tik om te kopiëren` : "Vriendcode laden"}
        >
          <span className="flex items-center gap-1.5 text-[10px] font-semibold uppercase tracking-wide text-muted">
            Jouw code
            <span className={`flex items-center gap-1 normal-case tracking-normal transition ${copied ? "text-accent" : "opacity-70 group-hover:opacity-100"}`} aria-live="polite">
              <CopyIcon size={11} />
              {copied ? "Gekopieerd" : "kopieer"}
            </span>
          </span>
          {code ? (
            <span className="block select-all font-mono text-lg font-bold tracking-widest">{code}</span>
          ) : (
            <span className="skeleton mt-1 block h-6 w-28" />
          )}
        </button>
        <button
          type="button"
          className="btn-ghost h-10 w-10 shrink-0 p-0"
          onClick={() => setQr(true)}
          disabled={!code}
          aria-label="Toon QR-code"
        >
          <QrIcon size={18} />
        </button>
        <button type="button" className="btn-primary h-10 shrink-0 px-3 text-xs" onClick={share} disabled={!code}>
          <ShareIcon size={14} /> Deel link
        </button>
      </div>
      {!onMessage && flash && (
        <p role="status" className={`animate-fade-in mt-2 text-sm ${flash.error ? "text-danger" : "text-accent"}`}>
          {flash.text}
        </p>
      )}

      <Sheet open={qr} onClose={() => setQr(false)} title="Scan om vrienden te worden">
        {code && (
          <div className="space-y-4 pb-2 text-center">
            <FriendQR value={friendLink(code)} label={`QR-code met jouw vriendlink, code ${code}`} />
            <div>
              <p className="font-mono text-2xl font-bold tracking-[0.3em]">{code}</p>
              <p className="mt-1 text-sm text-muted">
                Laat je vriend dit scannen met de camera. Na één tik op Vriend toevoegen zijn jullie vrienden.
              </p>
            </div>
            <button type="button" className="btn-ghost w-full" onClick={share}>
              <ShareIcon size={14} /> Link delen
            </button>
          </div>
        )}
      </Sheet>
    </>
  );
}
