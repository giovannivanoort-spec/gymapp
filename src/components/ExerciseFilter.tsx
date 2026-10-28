"use client";

import { useMemo, useState } from "react";
import { EXERCISES } from "@/lib/exercises";
import type { Exercise } from "@/lib/exercise-types";
import { MUSCLE_BY_ID, MUSCLE_GROUPS, musclesInGroup, type MuscleGroupId, type MuscleId } from "@/lib/muscles";

/** Zoekbalk + filter op spiergroep en daarbinnen op losse spier; geeft de gefilterde oefeningen door. */
export function ExerciseFilter({ children }: { children: (list: Exercise[]) => React.ReactNode }) {
  const [query, setQuery] = useState("");
  const [group, setGroup] = useState<MuscleGroupId | null>(null);
  const [muscle, setMuscle] = useState<MuscleId | null>(null);

  const list = useMemo(() => {
    const q = query.trim().toLowerCase();
    const hits = (e: Exercise, m: MuscleId[]) =>
      muscle ? m.includes(muscle) : group ? m.some((x) => MUSCLE_BY_ID[x].group === group) : true;
    return EXERCISES.filter((e) => {
      if (!hits(e, [...e.primary, ...e.secondary])) return false;
      if (!q) return true;
      return e.name.toLowerCase().includes(q) || e.slug.includes(q.replace(/\s+/g, "-"));
    }).sort((a, b) => {
      // Oefeningen waarbij de gekozen spier(groep) een hoofdspier is eerst.
      if (!group && !muscle) return 0;
      return Number(hits(b, b.primary)) - Number(hits(a, a.primary));
    });
  }, [query, group, muscle]);

  return (
    <div className="space-y-3">
      <input
        className="input"
        placeholder="Zoek oefening, bijv. hammer curl"
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        type="search"
      />
      <div className="-mx-1 flex gap-1.5 overflow-x-auto px-1 pb-1">
        <FilterChip
          active={group === null}
          onClick={() => {
            setGroup(null);
            setMuscle(null);
          }}
        >
          Alles
        </FilterChip>
        {MUSCLE_GROUPS.map((g) => (
          <FilterChip
            key={g.id}
            active={group === g.id}
            onClick={() => {
              setGroup(g.id);
              setMuscle(null);
            }}
          >
            {g.name}
          </FilterChip>
        ))}
      </div>
      {group && musclesInGroup(group).length > 1 && (
        <div className="-mx-1 flex gap-1.5 overflow-x-auto px-1 pb-1">
          <SubChip active={muscle === null} onClick={() => setMuscle(null)}>
            Hele groep
          </SubChip>
          {musclesInGroup(group).map((m) => (
            <SubChip key={m.id} active={muscle === m.id} onClick={() => setMuscle(m.id)}>
              {m.short}
            </SubChip>
          ))}
        </div>
      )}
      {list.length === 0 ? <p className="py-8 text-center text-muted">Geen oefeningen gevonden.</p> : children(list)}
    </div>
  );
}

function FilterChip({ active, onClick, children }: { active: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      onClick={onClick}
      className={`shrink-0 whitespace-nowrap rounded-full border px-3 py-1.5 text-xs font-medium ${
        active ? "border-accent bg-accent text-accent-ink" : "border-line text-muted"
      }`}
    >
      {children}
    </button>
  );
}

function SubChip({ active, onClick, children }: { active: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      onClick={onClick}
      className={`shrink-0 whitespace-nowrap rounded-lg px-2.5 py-1 text-xs ${
        active ? "bg-surface-2 font-semibold text-accent" : "text-muted hover:text-ink"
      }`}
    >
      {children}
    </button>
  );
}
