"use client";

import { useEffect, useState } from "react";

type Encoded = { value: string; size: number; path: string } | { value: string; error: true };

/**
 * QR-code van een link (als SVG), zodat een vriend naast je in de gym hem kan scannen.
 * De encoder (@zxing/library, zit al in de app voor de barcodescanner) wordt pas geladen als
 * dit onderdeel getoond wordt.
 */
export function FriendQR({ value, label }: { value: string; label: string }) {
  const [encoded, setEncoded] = useState<Encoded | null>(null);

  useEffect(() => {
    let cancelled = false;
    import("@zxing/library")
      .then(({ QRCodeEncoder, QRCodeDecoderErrorCorrectionLevel }) => {
        const matrix = QRCodeEncoder.encode(value, QRCodeDecoderErrorCorrectionLevel.M).getMatrix();
        const size = matrix.getWidth();
        let path = "";
        for (let y = 0; y < size; y++) {
          for (let x = 0; x < size; x++) if (matrix.get(x, y) === 1) path += `M${x} ${y}h1v1h-1z`;
        }
        if (!cancelled) setEncoded({ value, size, path });
      })
      .catch(() => {
        if (!cancelled) setEncoded({ value, error: true });
      });
    return () => {
      cancelled = true;
    };
  }, [value]);

  const current = encoded?.value === value ? encoded : null;
  const QUIET = 3;

  return (
    <div className="mx-auto aspect-square w-full max-w-[260px] rounded-3xl bg-white p-3 shadow-[0_0_0_1px_var(--color-line)]">
      {!current ? (
        <div className="skeleton h-full w-full rounded-2xl !bg-neutral-200" aria-label="QR-code laden" />
      ) : "error" in current ? (
        <div className="flex h-full items-center justify-center p-4 text-center text-sm text-neutral-600">
          Kon de QR-code niet maken. Deel de link of code in plaats daarvan.
        </div>
      ) : (
        <svg
          viewBox={`${-QUIET} ${-QUIET} ${current.size + QUIET * 2} ${current.size + QUIET * 2}`}
          className="animate-fade-in h-full w-full"
          shapeRendering="crispEdges"
          role="img"
          aria-label={label}
        >
          <path d={current.path} fill="#0b0d10" />
        </svg>
      )}
    </div>
  );
}
