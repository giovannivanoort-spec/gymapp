"use client";

import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { AppShell } from "@/components/AppShell";
import { useUserId } from "@/components/AuthProvider";
import { NewWorkoutContent, resolveNewWorkout, type NewWorkoutView } from "@/components/NewWorkoutButton";

/**
 * Snelkoppeling "Nieuwe training" (lang indrukken op het app-icoon). Doet hetzelfde als de
 * plusknop: direct naar het plannen als dat kan, anders kiezen of uitleg.
 */
export default function NewWorkoutPage() {
  const userId = useUserId();
  const router = useRouter();
  const [view, setView] = useState<NewWorkoutView | null>(null);
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    if (!userId) return;
    let alive = true;
    resolveNewWorkout(userId).then((result) => {
      if (!alive) return;
      if ("go" in result) router.replace(result.go);
      else setView(result.view);
    });
    return () => {
      alive = false;
    };
  }, [userId, router, attempt]);

  return (
    <AppShell title="Nieuwe training" back="/">
      <div className="card">
        <NewWorkoutContent
          view={view}
          onView={setView}
          onRetry={() => {
            setView(null);
            setAttempt((a) => a + 1);
          }}
          onGo={(href) => router.push(href)}
        />
      </div>
    </AppShell>
  );
}
