"use client";

import Link from "next/link";
import { DumbbellIcon, PlusIcon, RefreshIcon } from "@/components/Icons";
import type { MyGroup } from "@/lib/groups";

/**
 * Je groepen als één rij compacte chips: de meeste mensen zitten in één of twee groepen en openen
 * die zelden vanaf Home. Nieuwe groep en code invoeren zitten achter één knop.
 */
export function HomeGroups({
  groups,
  failed,
  onAdd,
  onNew,
  onJoin,
  onRetry,
}: {
  groups: MyGroup[] | undefined;
  failed: boolean;
  /** Keuzemenu: nieuwe groep of code invoeren. */
  onAdd: () => void;
  onNew: () => void;
  onJoin: () => void;
  onRetry: () => void;
}) {
  return (
    <section className="space-y-3" aria-labelledby="home-groups">
      <div className="flex items-center justify-between gap-2">
        <h2 id="home-groups" className="text-sm font-semibold uppercase tracking-wide text-muted">
          Mijn groepen
        </h2>
        {!!groups?.length && (
          <button
            type="button"
            onClick={onAdd}
            className="-my-3 flex min-h-11 items-center gap-1 px-1 text-xs font-semibold text-muted hover:text-ink"
            aria-label="Groep toevoegen: nieuwe groep of code invoeren"
          >
            <PlusIcon size={14} /> Toevoegen
          </button>
        )}
      </div>

      {groups === undefined ? (
        failed ? (
          <div className="card flex items-center gap-3 py-3">
            <p className="min-w-0 flex-1 text-sm text-muted">Je groepen konden niet worden geladen.</p>
            <button
              type="button"
              onClick={onRetry}
              className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full text-muted transition hover:text-ink active:scale-95"
              aria-label="Groepen opnieuw laden"
            >
              <RefreshIcon size={18} />
            </button>
          </div>
        ) : (
          <div className="flex gap-2" aria-label="Groepen laden">
            <span className="skeleton block h-12 w-40 rounded-full" />
            <span className="skeleton block h-12 w-32 rounded-full" />
          </div>
        )
      ) : groups.length === 0 ? (
        <div className="card animate-fade-up space-y-3">
          <div className="flex items-center gap-3">
            <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-surface-2 text-accent">
              <DumbbellIcon size={20} />
            </span>
            <div className="min-w-0">
              <p className="text-sm font-semibold">Je zit nog niet in een groep</p>
              <p className="text-xs text-muted">Maak er een en deel de link, of voer een code in die je kreeg.</p>
            </div>
          </div>
          <div className="grid grid-cols-2 gap-2">
            <button type="button" className="btn-ghost" onClick={onJoin}>
              Code invoeren
            </button>
            <button type="button" className="btn-primary" onClick={onNew}>
              <PlusIcon size={16} /> Nieuwe groep
            </button>
          </div>
        </div>
      ) : (
        <ul className="-mx-4 flex gap-2 overflow-x-auto px-4 pb-1 [scrollbar-width:none]">
          {groups.map((g, i) => (
            <li key={g.id} className="shrink-0">
              <Link
                href={`/groups/${g.id}`}
                className="animate-fade-up flex min-h-12 max-w-[240px] items-center gap-2.5 rounded-full border border-line bg-surface py-1.5 pl-1.5 pr-4 transition hover:border-muted active:scale-[0.98]"
                style={{ "--i": i } as React.CSSProperties}
                aria-label={`${g.name}, ${g.memberCount} ${g.memberCount === 1 ? "lid" : "leden"}, je bent ${g.role === "trainer" ? "trainer" : "lid"}`}
              >
                <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-surface-2 text-sm font-bold text-accent">
                  {g.name.slice(0, 1).toUpperCase()}
                </span>
                <span className="min-w-0">
                  <span className="block truncate text-sm font-semibold leading-tight">{g.name}</span>
                  <span className="block text-[11px] leading-tight text-muted">
                    {g.memberCount} {g.memberCount === 1 ? "lid" : "leden"}
                    {g.role === "trainer" && <span className="text-accent"> · Trainer</span>}
                  </span>
                </span>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
