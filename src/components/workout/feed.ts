"use client";

import { supabase } from "@/lib/supabase";

/**
 * Houdt de groepsfeed in lijn met de sets: wordt de set die een record of promotie opleverde
 * gewist of verbeterd naar iets lagers, dan wordt de activiteit bijgewerkt of ingetrokken.
 * Zonder rechten (of zonder de nieuwste database-upgrade) gebeurt er stilletjes niets.
 */
export async function syncFeedAfterChange(k: {
  workoutId: string;
  userId: string;
  slug: string;
  /** Nieuwe beschrijving van het record, of null als er vandaag geen record meer is. */
  prDetail: string | null;
  /** Hoogste rang die vandaag nog behaald is (null = geen promotie meer). */
  tierIndex: number | null;
}) {
  try {
    const { data, error } = await supabase
      .from("activities")
      .select("id, type, payload")
      .eq("workout_id", k.workoutId)
      .eq("user_id", k.userId)
      .in("type", ["pr", "promotion"])
      .eq("payload->>slug", k.slug);
    if (error || !data?.length) return;
    const remove: string[] = [];
    for (const a of data as { id: string; type: string; payload: { tierIndex?: number; detail?: string } | null }[]) {
      if (a.type === "pr") {
        if (k.prDetail == null) remove.push(a.id);
        else if (a.payload?.detail !== k.prDetail) {
          await supabase
            .from("activities")
            .update({ payload: { ...(a.payload ?? {}), slug: k.slug, detail: k.prDetail } })
            .eq("id", a.id);
        }
      } else if (k.tierIndex == null || (a.payload?.tierIndex ?? 0) > k.tierIndex) {
        remove.push(a.id);
      }
    }
    if (remove.length) await supabase.from("activities").delete().in("id", remove);
  } catch {
    // De feed bijwerken is niet essentieel.
  }
}
