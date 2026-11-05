"use client";

import { useDeferredValue, useEffect, useMemo, useState } from "react";
import { EXERCISES } from "@/lib/exercises";
import { EQUIPMENT_LABEL, type Equipment, type Exercise } from "@/lib/exercise-types";
import {
  GROUP_BY_ID,
  MUSCLE_BY_ID,
  MUSCLE_GROUPS,
  REGION_LABEL,
  musclesInGroup,
  type MuscleGroupId,
  type MuscleId,
} from "@/lib/muscles";

const EQUIPMENT_ORDER: Equipment[] = ["barbell", "dumbbell", "cable", "machine", "bodyweight", "kettlebell", "ez_bar", "band"];

/** Kleine letters zonder accenten: "Rhomboïden" vindt ook "rhomboiden". */
export function fold(s: string): string {
  return s.toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "");
}

/** Woorden die mensen in de sportschool gebruiken voor het materiaal ("halter", "stang", "toestel"). */
const EQUIPMENT_SYNONYMS: Record<Equipment, string> = {
  barbell: "stang lange halter halterstang olympische stang",
  dumbbell: "halter halters dumbbell losse gewichten",
  cable: "kabel kabels katrol cable pulley",
  machine: "apparaat apparaten toestel toestellen machine",
  bodyweight: "eigen gewicht lichaamsgewicht zonder gewicht bodyweight",
  kettlebell: "kogelhalter kettlebell",
  ez_bar: "ez stang krulstang curlstang",
  band: "elastiek elastieken band weerstandsband",
};

const haystacks = new Map<string, string>();
/** Zoektekst per oefening: naam, slug, materiaal (NL + EN + spreektaal) en de hoofdspieren met hun groep. */
function haystack(e: Exercise): string {
  let h = haystacks.get(e.slug);
  if (h === undefined) {
    const muscles = e.primary.flatMap((id) => {
      const m = MUSCLE_BY_ID[id];
      const g = GROUP_BY_ID[m.group];
      return [m.name, m.short, g.name, g.id, REGION_LABEL[g.region]];
    });
    h = fold([e.name, e.slug.replace(/-/g, " "), EQUIPMENT_LABEL[e.equipment], e.equipment.replace("_", " "), EQUIPMENT_SYNONYMS[e.equipment], ...muscles].join(" | "));
    haystacks.set(e.slug, h);
  }
  return h;
}

type SavedFilter = { q: string; g: MuscleGroupId | null; m: MuscleId | null; eq: Equipment | null };
const FILTER_PREFIX = "gymapp-filter:v1:";

/** Bewaarde filters voor deze sessie (bijv. na het openen van een oefening en terug). */
function readFilter(key: string | undefined): SavedFilter {
  const empty: SavedFilter = { q: "", g: null, m: null, eq: null };
  if (!key || typeof window === "undefined") return empty;
  try {
    const raw = JSON.parse(sessionStorage.getItem(FILTER_PREFIX + key) ?? "null") as Partial<SavedFilter> | null;
    if (!raw) return empty;
    const g = raw.g && GROUP_BY_ID[raw.g] ? raw.g : null;
    const m = raw.m && MUSCLE_BY_ID[raw.m] && (!g || MUSCLE_BY_ID[raw.m].group === g) ? raw.m : null;
    const eq = raw.eq && raw.eq in EQUIPMENT_LABEL ? raw.eq : null;
    return { q: typeof raw.q === "string" ? raw.q.slice(0, 80) : "", g, m, eq };
  } catch {
    return empty;
  }
}

/**
 * Zoekbalk + filters (materiaal, spiergroep en daarbinnen de losse spier); geeft de gefilterde
 * oefeningen door. Zoeken werkt ook op Nederlandse spier- en materiaalnamen ("borst", "kabel").
 */
export function ExerciseFilter({
  children,
  exercises = EXERCISES,
  prioritize,
  muscleFilters = true,
  placeholder = "Zoek op naam, spier of materiaal",
  autoFocus,
  storageKey,
}: {
  children: (list: Exercise[]) => React.ReactNode;
  /** Bronlijst (standaard alle oefeningen). */
  exercises?: Exercise[];
  /** Slugs die bovenaan komen zolang er niet gezocht of gefilterd wordt (bijv. recent gebruikt). */
  prioritize?: string[];
  /** Spiergroep-filters tonen. */
  muscleFilters?: boolean;
  placeholder?: string;
  autoFocus?: boolean;
  /** Bewaar zoekterm en filters voor deze sessie onder deze naam (bijv. "library" of "picker"). */
  storageKey?: string;
}) {
  const [saved] = useState(() => readFilter(storageKey));
  const [query, setQuery] = useState(saved.q);
  const [group, setGroup] = useState<MuscleGroupId | null>(saved.g);
  const [muscle, setMuscle] = useState<MuscleId | null>(saved.m);
  const [equipment, setEquipment] = useState<Equipment | null>(saved.eq);

  useEffect(() => {
    if (!storageKey) return;
    try {
      const value: SavedFilter = { q: query, g: group, m: muscle, eq: equipment };
      if (!query && !group && !muscle && !equipment) sessionStorage.removeItem(FILTER_PREFIX + storageKey);
      else sessionStorage.setItem(FILTER_PREFIX + storageKey, JSON.stringify(value));
    } catch {
      // geen opslag beschikbaar: filters gelden dan alleen zolang dit scherm open is
    }
  }, [storageKey, query, group, muscle, equipment]);
  // Typen blijft vloeiend: de lijst volgt met een kleine vertraging als het druk is.
  const deferredQuery = useDeferredValue(query);

  const equipmentOptions = useMemo(() => {
    const present = new Set(exercises.map((e) => e.equipment));
    return EQUIPMENT_ORDER.filter((q) => present.has(q));
  }, [exercises]);

  const list = useMemo(() => {
    const tokens = fold(deferredQuery).split(/\s+/).filter(Boolean);
    const hits = (m: MuscleId[]) =>
      muscle ? m.includes(muscle) : group ? m.some((x) => MUSCLE_BY_ID[x].group === group) : true;
    const filtered = exercises.filter((e) => {
      if (equipment && e.equipment !== equipment) return false;
      if (!hits([...e.primary, ...e.secondary])) return false;
      if (tokens.length === 0) return true;
      const h = haystack(e);
      return tokens.every((t) => h.includes(t));
    });
    const prio = new Map((prioritize ?? []).map((s, i) => [s, i]));
    const nameScore = (e: Exercise) => {
      if (tokens.length === 0) return 0;
      const n = fold(e.name);
      if (n.startsWith(tokens[0])) return 0;
      return tokens.every((t) => n.includes(t)) ? 1 : 2;
    };
    return filtered
      .map((e, i) => ({ e, i }))
      .sort((a, b) => {
        // Oefeningen waarbij de gekozen spier(groep) een hoofdspier is eerst.
        if (group || muscle) {
          const d = Number(hits(b.e.primary)) - Number(hits(a.e.primary));
          if (d) return d;
        }
        if (tokens.length) {
          const d = nameScore(a.e) - nameScore(b.e);
          if (d) return d;
        } else if (prio.size && !group && !muscle && !equipment) {
          const d = (prio.get(a.e.slug) ?? 1e6) - (prio.get(b.e.slug) ?? 1e6);
          if (d) return d;
        }
        return a.i - b.i;
      })
      .map((x) => x.e);
  }, [exercises, deferredQuery, group, muscle, equipment, prioritize]);

  const filtering = !!(query.trim() || group || muscle || equipment);
  const stale = query !== deferredQuery;

  function reset() {
    setQuery("");
    setGroup(null);
    setMuscle(null);
    setEquipment(null);
  }

  return (
    <div className="space-y-3">
      <div className="relative">
        <svg
          className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-muted"
          width="18"
          height="18"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          aria-hidden
        >
          <circle cx="11" cy="11" r="7" />
          <path d="M20 20l-3.5-3.5" strokeLinecap="round" />
        </svg>
        <input
          className="input pl-10"
          placeholder={placeholder}
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          type="search"
          enterKeyHint="search"
          aria-label="Zoek oefening"
          autoFocus={autoFocus}
        />
      </div>

      {equipmentOptions.length > 1 && (
        <div className="-mx-1 -mt-1.5 flex gap-1.5 overflow-x-auto px-1" role="group" aria-label="Materiaal">
          {equipmentOptions.map((q) => (
            <EquipChip key={q} active={equipment === q} onClick={() => setEquipment(equipment === q ? null : q)}>
              {EQUIPMENT_LABEL[q]}
            </EquipChip>
          ))}
        </div>
      )}

      {muscleFilters && (
        <div className="-mx-1 -mt-1.5 flex gap-1.5 overflow-x-auto px-1" role="group" aria-label="Spiergroep">
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
      )}
      {muscleFilters && group && musclesInGroup(group).length > 1 && (
        <div className="-mx-1 -mt-1.5 flex gap-1.5 overflow-x-auto px-1" role="group" aria-label="Spier">
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

      {filtering && (
        <div className="flex items-center justify-between text-xs text-muted" aria-live="polite">
          <span>
            {list.length} {list.length === 1 ? "oefening" : "oefeningen"}
          </span>
          <button onClick={reset} className="-my-2 -mr-2 min-h-11 rounded-lg px-3 font-medium hover:text-ink">
            Wis filters
          </button>
        </div>
      )}

      <div className={`transition-opacity duration-150 ${stale ? "opacity-60" : ""}`}>
        {list.length === 0 ? (
          <div className="py-8 text-center">
            <p className="text-muted">Geen oefeningen gevonden.</p>
            <p className="mt-1 text-xs text-muted">Probeer een spier (bijv. &quot;borst&quot;) of materiaal (bijv. &quot;halter&quot;).</p>
            {filtering && (
              <button onClick={reset} className="btn-ghost mt-3 min-h-11 px-4 text-xs">
                Wis filters
              </button>
            )}
          </div>
        ) : (
          children(list)
        )}
      </div>
    </div>
  );
}

/*
 * Chips zijn compact (zo passen er meer op een regel), maar de tikzone is altijd 44px hoog:
 * de knop zelf is min-h-11 en transparant, de zichtbare pil zit erin.
 */
function FilterChip({ active, onClick, children }: { active: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button onClick={onClick} aria-pressed={active} className="group flex min-h-11 shrink-0 items-center active:scale-95">
      <span
        className={`flex h-9 items-center whitespace-nowrap rounded-full border px-3.5 text-xs font-medium transition-colors ${
          active ? "border-accent bg-accent text-accent-ink" : "border-line text-muted group-hover:text-ink"
        }`}
      >
        {children}
      </span>
    </button>
  );
}

function EquipChip({ active, onClick, children }: { active: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button onClick={onClick} aria-pressed={active} className="group flex min-h-11 shrink-0 items-center active:scale-95">
      <span
        className={`flex h-8 items-center whitespace-nowrap rounded-full border px-3 text-xs font-medium transition-colors ${
          active ? "border-accent text-accent" : "border-line/70 text-muted group-hover:text-ink"
        }`}
      >
        {children}
      </span>
    </button>
  );
}

function SubChip({ active, onClick, children }: { active: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button onClick={onClick} aria-pressed={active} className="group flex min-h-11 shrink-0 items-center active:scale-95">
      <span
        className={`flex h-8 items-center whitespace-nowrap rounded-lg px-3 text-xs transition-colors ${
          active ? "bg-surface-2 font-semibold text-accent" : "text-muted group-hover:text-ink"
        }`}
      >
        {children}
      </span>
    </button>
  );
}
