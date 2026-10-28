"use client";

import { useEffect, useEffectEvent, useRef, useState } from "react";
import type { IScannerControls } from "@zxing/browser";
import type { DecodeHintType } from "@zxing/library";
import { CloseIcon } from "./Icons";

/* Native BarcodeDetector staat (nog) niet in lib.dom. */
type DetectedBarcode = { rawValue: string; format: string };
type BarcodeDetectorLike = { detect(source: CanvasImageSource): Promise<DetectedBarcode[]> };
type BarcodeDetectorCtor = {
  new (opts?: { formats: string[] }): BarcodeDetectorLike;
  getSupportedFormats(): Promise<string[]>;
};

const NATIVE_FORMATS = ["ean_13", "ean_8", "upc_a", "upc_e"];
const SCAN_INTERVAL_MS = 150;

type Status = "starting" | "scanning" | "denied" | "unavailable" | "insecure" | "busy" | "error";

const MESSAGES: Partial<Record<Status, string>> = {
  denied: "Geen toegang tot je camera. Geef toestemming in je browserinstellingen of typ de barcode hieronder.",
  unavailable: "Geen camera gevonden op dit apparaat. Typ de barcode hieronder.",
  insecure: "De camera werkt alleen via een beveiligde verbinding (https). Typ de barcode hieronder.",
  busy: "Je camera wordt al door een andere app gebruikt. Sluit die app en probeer het opnieuw.",
  error: "De camera kon niet starten. Probeer het opnieuw of typ de barcode hieronder.",
};

class CameraUnsupportedError extends Error {}

function statusForError(e: unknown): Status {
  if (e instanceof CameraUnsupportedError) {
    return typeof window !== "undefined" && !window.isSecureContext ? "insecure" : "unavailable";
  }
  const name = e instanceof DOMException || e instanceof Error ? e.name : "";
  if (name === "NotAllowedError" || name === "SecurityError" || name === "PermissionDeniedError") return "denied";
  if (name === "NotFoundError" || name === "OverconstrainedError" || name === "DevicesNotFoundError") return "unavailable";
  if (name === "NotReadableError" || name === "TrackStartError" || name === "AbortError") return "busy";
  return "error";
}

const isBarcode = (code: string) => /^\d{8}$|^\d{12,14}$/.test(code);

function getNativeDetector(): BarcodeDetectorCtor | null {
  const ctor = (globalThis as { BarcodeDetector?: BarcodeDetectorCtor }).BarcodeDetector;
  return typeof ctor === "function" ? ctor : null;
}

/** Volledig scherm camera-overlay die EAN-13/EAN-8/UPC-A/UPC-E barcodes leest. */
export function BarcodeScanner({
  open,
  onClose,
  onDetected,
}: {
  open: boolean;
  onClose: () => void;
  onDetected: (code: string) => void;
}) {
  // Elke keer openen = verse mount, dus de status begint altijd bij "starting".
  if (!open) return null;
  return <ScannerOverlay onClose={onClose} onDetected={onDetected} />;
}

function ScannerOverlay({ onClose, onDetected }: { onClose: () => void; onDetected: (code: string) => void }) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const stopRef = useRef<(() => void) | null>(null);
  const doneRef = useRef(false);
  const [status, setStatus] = useState<Status>("starting");
  const [attempt, setAttempt] = useState(0);
  const [manual, setManual] = useState("");
  const [manualError, setManualError] = useState<string | null>(null);

  const emitDetected = useEffectEvent((code: string) => {
    if (doneRef.current) return;
    doneRef.current = true;
    navigator.vibrate?.(60);
    stopRef.current?.();
    onDetected(code);
  });

  // Escape sluit, en de pagina eronder scrollt niet mee.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    document.addEventListener("keydown", onKey);
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.removeEventListener("keydown", onKey);
      document.body.style.overflow = prev;
    };
  }, [onClose]);

  // Camera + decoder starten; bij sluiten/unmount alles netjes stoppen.
  useEffect(() => {
    const video = videoRef.current;
    let cancelled = false;
    let stream: MediaStream | null = null;
    let controls: IScannerControls | null = null;
    let timer: ReturnType<typeof setTimeout> | undefined;

    const stopAll = () => {
      cancelled = true;
      clearTimeout(timer);
      try {
        controls?.stop();
      } catch {
        /* al gestopt */
      }
      controls = null;
      stream?.getTracks().forEach((t) => t.stop());
      stream = null;
      if (video) {
        video.pause();
        video.srcObject = null;
      }
    };
    stopRef.current = stopAll;

    const getStream = async () => {
      if (!navigator.mediaDevices?.getUserMedia) throw new CameraUnsupportedError();
      return navigator.mediaDevices.getUserMedia({
        audio: false,
        video: { facingMode: { ideal: "environment" }, width: { ideal: 1280 }, height: { ideal: 720 } },
      });
    };

    const startNative = async (Ctor: BarcodeDetectorCtor, v: HTMLVideoElement): Promise<boolean> => {
      let supported: string[] = [];
      try {
        supported = await Ctor.getSupportedFormats();
      } catch {
        return false;
      }
      const formats = NATIVE_FORMATS.filter((f) => supported.includes(f));
      if (formats.length === 0 || cancelled) return false;
      const detector = new Ctor({ formats });
      const tick = async () => {
        if (cancelled) return;
        if (v.readyState >= 2) {
          try {
            const found = await detector.detect(v);
            const hit = found.map((b) => b.rawValue.trim()).find(isBarcode);
            if (hit && !cancelled) {
              emitDetected(hit);
              return;
            }
          } catch {
            /* frame overslaan */
          }
        }
        if (!cancelled) timer = setTimeout(tick, SCAN_INTERVAL_MS);
      };
      void tick();
      return true;
    };

    const startZxing = async (v: HTMLVideoElement) => {
      const [{ BrowserMultiFormatReader }, { BarcodeFormat, DecodeHintType: Hint }] = await Promise.all([
        import("@zxing/browser"),
        import("@zxing/library"),
      ]);
      if (cancelled) return;
      const hints = new Map<DecodeHintType, unknown>([
        [Hint.POSSIBLE_FORMATS, [BarcodeFormat.EAN_13, BarcodeFormat.EAN_8, BarcodeFormat.UPC_A, BarcodeFormat.UPC_E]],
      ]);
      const reader = new BrowserMultiFormatReader(hints, { delayBetweenScanAttempts: SCAN_INTERVAL_MS });
      const c = await reader.decodeFromVideoElement(v, (result) => {
        const text = result?.getText().trim();
        if (text && isBarcode(text) && !cancelled) emitDetected(text);
      });
      if (cancelled) c.stop();
      else controls = c;
    };

    getStream()
      .then(async (s) => {
        if (cancelled || !video) {
          s.getTracks().forEach((t) => t.stop());
          return;
        }
        stream = s;
        video.srcObject = s;
        await video.play().catch(() => undefined);
        if (cancelled) return;
        setStatus("scanning");
        const Native = getNativeDetector();
        const usingNative = Native ? await startNative(Native, video) : false;
        if (!usingNative && !cancelled) await startZxing(video);
      })
      .catch((e: unknown) => {
        if (cancelled) return;
        stopAll();
        setStatus(statusForError(e));
      });

    return () => {
      stopAll();
      if (stopRef.current === stopAll) stopRef.current = null;
    };
  }, [attempt]);

  const retry = () => {
    setStatus("starting");
    setAttempt((a) => a + 1);
  };

  const submitManual = (e: React.FormEvent) => {
    e.preventDefault();
    const code = manual.replace(/\D/g, "");
    if (code.length < 8 || code.length > 14) {
      setManualError("Een barcode heeft 8 tot 14 cijfers.");
      return;
    }
    if (doneRef.current) return;
    doneRef.current = true;
    stopRef.current?.();
    onDetected(code);
  };

  const message = MESSAGES[status];
  const canRetry = status === "denied" || status === "busy" || status === "error";

  return (
    <div className="animate-fade-in fixed inset-0 z-[60] flex flex-col bg-black text-ink" role="dialog" aria-modal aria-label="Barcode scannen">
      <style>{`@keyframes barcode-scan-line{0%{top:10%}100%{top:90%}}`}</style>

      {/* Camerabeeld */}
      <video
        ref={videoRef}
        className={`absolute inset-0 h-full w-full object-cover transition-opacity duration-300 ${status === "scanning" ? "opacity-100" : "opacity-0"}`}
        playsInline
        muted
        autoPlay
      />

      {/* Bovenbalk */}
      <div className="relative z-10 flex items-center justify-between px-4 pt-[max(1rem,env(safe-area-inset-top))]">
        <p className="text-sm font-semibold text-white/90">Barcode scannen</p>
        <button
          onClick={onClose}
          className="rounded-full bg-black/50 p-2.5 text-white backdrop-blur transition hover:bg-black/70 active:scale-95"
          aria-label="Sluiten"
        >
          <CloseIcon size={22} />
        </button>
      </div>

      {/* Scanvak */}
      <div className="relative z-10 flex flex-1 flex-col items-center justify-center px-6">
        <div className="relative aspect-[16/10] w-full max-w-[320px] rounded-2xl shadow-[0_0_0_200vmax_rgba(0,0,0,0.55)]">
          {/* Hoeken */}
          <span className="absolute left-0 top-0 h-7 w-7 rounded-tl-2xl border-l-[3px] border-t-[3px] border-accent" />
          <span className="absolute right-0 top-0 h-7 w-7 rounded-tr-2xl border-r-[3px] border-t-[3px] border-accent" />
          <span className="absolute bottom-0 left-0 h-7 w-7 rounded-bl-2xl border-b-[3px] border-l-[3px] border-accent" />
          <span className="absolute bottom-0 right-0 h-7 w-7 rounded-br-2xl border-b-[3px] border-r-[3px] border-accent" />

          {status === "scanning" && (
            <span
              className="absolute inset-x-4 h-0.5 rounded-full bg-accent/80 shadow-[0_0_12px_2px_rgba(200,245,58,0.45)]"
              style={{ animation: "barcode-scan-line 1.8s ease-in-out infinite alternate" }}
            />
          )}

          {status === "starting" && (
            <div className="absolute inset-0 flex items-center justify-center">
              <span className="text-sm text-white/70">Camera starten...</span>
            </div>
          )}

          {message && (
            <div className="absolute inset-0 flex flex-col items-center justify-center gap-3 p-4 text-center">
              <CameraOffIcon />
              <p className="text-sm leading-snug text-white/85">{message}</p>
              {canRetry && (
                <button onClick={retry} className="btn-ghost px-3 py-1.5 text-xs">
                  Opnieuw proberen
                </button>
              )}
            </div>
          )}
        </div>
        {!message && <p className="mt-5 text-center text-sm font-medium text-white/90">Richt de camera op de barcode</p>}
      </div>

      {/* Handmatig invoeren */}
      <form
        onSubmit={submitManual}
        className="relative z-10 border-t border-line bg-surface/95 px-4 pt-4 pb-[max(1rem,env(safe-area-inset-bottom))] backdrop-blur"
      >
        <div className="mx-auto max-w-md">
          <label htmlFor="barcode-manual" className="label">
            Of typ de barcode
          </label>
          <div className="flex gap-2">
            <input
              id="barcode-manual"
              className="input flex-1 tracking-wider"
              inputMode="numeric"
              autoComplete="off"
              placeholder="Bijv. 8710400169543"
              maxLength={20}
              value={manual}
              onChange={(e) => {
                setManual(e.target.value.replace(/[^\d\s]/g, ""));
                setManualError(null);
              }}
            />
            <button type="submit" className="btn-primary shrink-0" disabled={manual.replace(/\D/g, "").length < 8}>
              Zoeken
            </button>
          </div>
          {manualError && <p className="mt-2 text-xs text-danger">{manualError}</p>}
        </div>
      </form>
    </div>
  );
}

function CameraOffIcon() {
  return (
    <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" className="text-white/70" aria-hidden>
      <path d="M3 3l18 18" />
      <path d="M9.5 5h5l1.5 2h3a2 2 0 012 2v8.5M17 19H5a2 2 0 01-2-2V9a2 2 0 012-2h2" />
      <path d="M9.8 10.2a3 3 0 004 4" />
    </svg>
  );
}
