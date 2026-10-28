"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { AppShell } from "@/components/AppShell";
import { analyzePlan } from "@/lib/analysis";
import { EXERCISE_BY_SLUG } from "@/lib/exercises";
import { GROUP_BY_ID } from "@/lib/muscles";
import { supabase } from "@/lib/supabase";
import type { Template } from "@/lib/types";

export default function TemplatesPage() {
  const [templates, setTemplates] = useState<Template[] | null>(null);

  useEffect(() => {
    supabase
      .from("templates")
      .select("*")
      .order("created_at", { ascending: false })
      .then(({ data }) => setTemplates(data ?? []));
  }, []);

  return (
    <AppShell
      title="Mijn schema's"
      action={
        <Link href="/templates/new" className="btn-primary px-3 py-1.5 text-xs">
          + Nieuw
        </Link>
      }
    >
      <p className="mb-4 text-sm text-muted">
        Een schema is een herbruikbare training. Bij het plannen van een groepstraining kies je “Schema laden” en staat
        alles in één keer klaar.
      </p>
      {templates === null ? (
        <div className="space-y-3"><div className="skeleton h-24" /><div className="skeleton h-40" /></div>
      ) : templates.length === 0 ? (
        <div className="card text-sm text-muted">Nog geen schema&apos;s. Maak je eerste, bijv. “Push day” of “Legs”.</div>
      ) : (
        <ul className="space-y-3">
          {templates.map((t) => {
            const top = analyzePlan(t.exercises)
              .groups.filter((l) => l.sets >= 2)
              .sort((a, b) => b.sets - a.sets)
              .slice(0, 4);
            return (
              <li key={t.id}>
                <Link href={`/templates/${t.id}`} className="card block space-y-2 hover:border-muted">
                  <div className="flex items-baseline justify-between">
                    <p className="font-semibold">{t.name}</p>
                    <span className="text-xs text-muted">{t.exercises.length} oefeningen</span>
                  </div>
                  <p className="line-clamp-2 text-sm text-muted">
                    {t.exercises.map((p) => EXERCISE_BY_SLUG[p.slug]?.name ?? p.slug).join(" · ")}
                  </p>
                  {top.length > 0 && (
                    <div className="flex flex-wrap gap-1.5">
                      {top.map((l) => (
                        <span key={l.id} className="rounded-full bg-accent/15 px-2 py-0.5 text-xs text-accent">
                          {GROUP_BY_ID[l.id].name}
                        </span>
                      ))}
                    </div>
                  )}
                </Link>
              </li>
            );
          })}
        </ul>
      )}
    </AppShell>
  );
}
