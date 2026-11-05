"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { Celebration, type CelebrationData } from "@/components/Celebration";
import { TIERS, type OverallRank } from "@/lib/ranks";

const storageKey = (userId: string) => `spotter:overall-tier-seen:${userId}`;

function readSeen(userId: string): number | null {
  try {
    const raw = localStorage.getItem(storageKey(userId));
    const n = raw == null ? NaN : Number(raw);
    return Number.isInteger(n) ? n : null;
  } catch {
    return null;
  }
}

/**
 * Eenmalige promotie als je (definitieve) totaalrang hoger is dan de hoogste die je eerder op dit
 * apparaat zag. De eerste keer slaan we alleen op: dan is er niets "nieuws" te vieren.
 */
export function OverallPromotion({ userId, overall }: { userId: string; overall: OverallRank | null }) {
  const idx = overall && !overall.provisional ? TIERS.indexOf(overall.tier) : null;
  const [seen, setSeen] = useState<number | null>(() => readSeen(userId));
  const [show, setShow] = useState<number | null>(null);

  // Nieuwe hoogste tier (ook als verse data binnenkomt terwijl de pagina open staat).
  if (idx != null && (seen == null || idx > seen)) {
    if (seen != null) setShow(idx);
    setSeen(idx);
  }

  useEffect(() => {
    if (seen == null) return;
    try {
      localStorage.setItem(storageKey(userId), String(seen));
    } catch {
      // Geen opslag (privévenster): dan zie je de promotie misschien nog eens, niet erg.
    }
  }, [userId, seen]);

  const close = useCallback(() => setShow(null), []);
  // Stabiel object: anders start de sluittimer van de viering bij elke render opnieuw.
  const data = useMemo<CelebrationData | null>(
    () => (show != null ? { kind: "promotion", tierIndex: show, exercise: "Totaalrang" } : null),
    [show],
  );
  return <Celebration data={data} onClose={close} />;
}
