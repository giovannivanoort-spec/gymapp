"use client";

import { useEffect } from "react";
import { invalidate } from "@/lib/cache";
import { supabase } from "@/lib/supabase";
import { groupKey } from "./groupData";

/** Terugval zonder realtime (bijv. tabel niet in de publicatie): zo vaak verversen zolang de pagina in beeld is. */
const POLL_MS = 90_000;

/**
 * Houdt de groepsdata live bij zolang de pagina open staat: plant de trainer een training (of
 * past hij er een aan), of komt er een lid bij, dan ziet iedereen dat meteen. Wijzigingen worden
 * even gebundeld. Werkt realtime niet, dan wordt er af en toe ververst.
 */
export function useGroupLive(groupId: string | null) {
  useEffect(() => {
    if (!groupId) return;
    let timer: ReturnType<typeof setTimeout> | null = null;
    const refresh = () => {
      if (timer) clearTimeout(timer);
      timer = setTimeout(() => invalidate(groupKey(groupId), { soft: true }), 800);
    };
    const filter = `group_id=eq.${groupId}`;
    const channel = supabase
      .channel(`group-live-${groupId}`)
      .on("postgres_changes", { event: "*", schema: "public", table: "workouts", filter }, refresh)
      .on("postgres_changes", { event: "*", schema: "public", table: "group_members", filter }, refresh)
      .subscribe();
    const poll = setInterval(() => {
      if (document.visibilityState === "visible") invalidate(groupKey(groupId), { soft: true });
    }, POLL_MS);
    return () => {
      if (timer) clearTimeout(timer);
      clearInterval(poll);
      supabase.removeChannel(channel);
    };
  }, [groupId]);
}
