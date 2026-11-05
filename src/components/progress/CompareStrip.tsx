"use client";

import Link from "next/link";
import { Avatar } from "@/components/Avatar";
import { ArrowDownIcon, ArrowUpIcon, UserPlusIcon } from "@/components/Icons";
import { RankBadge } from "@/components/RankBadge";
import { ageFrom } from "@/lib/dates";
import { useComparePeople, type ComparePerson } from "@/lib/progress/groupBoard";
import { TIERS, type OverallRank } from "@/lib/ranks";
import { useRanksState } from "@/lib/useRanks";

type Person = ComparePerson;

/** Verschil in totaalscore waaronder we "gelijk" zeggen (een tier is 1 punt breed). */
const TIE = 0.05;
/** CSS-volgorde: hoogste score eerst, zonder rang achteraan. */
const orderFor = (score: number | null) => (score == null ? 100_000 : -Math.round(score * 1000));

/**
 * "Vergelijk met" als mini-ranglijst: vrienden en groepsgenoten met hun totaalrang, gesorteerd op
 * score, met per persoon of die hoger of lager staat dan jij. Eén tik naar hun ranks naast de jouwe.
 *
 * Elke persoon rekent zijn eigen rang uit (gedeelde, gecachete geschiedenis en een gedeelde
 * berekening, zie useRanks) en zet zichzelf via CSS `order` op de juiste plek.
 */
export function CompareStrip({ me, mine, myName = "Jij" }: { me: string; mine?: OverallRank | null; myName?: string }) {
  const { people: known } = useComparePeople(me);
  const people = known ?? [];
  const loading = known === undefined;
  const ranked = mine !== undefined;

  return (
    <section className="space-y-3" aria-labelledby="compare-heading">
      <div className="flex items-baseline justify-between gap-3">
        <h2 id="compare-heading" className="text-sm font-semibold uppercase tracking-wide text-muted">
          Vergelijk met
        </h2>
        {ranked && people.length > 0 && <span className="text-xs text-muted">op totaalrang</span>}
      </div>
      {loading ? (
        <div className="flex gap-3" aria-busy="true" aria-label="Vrienden laden">
          {[0, 1, 2, 3].map((i) => (
            <div key={i} className="flex w-16 flex-col items-center gap-1.5">
              <div className="skeleton h-12 w-12 rounded-full" />
              <div className="skeleton h-3 w-10" />
            </div>
          ))}
        </div>
      ) : people.length === 0 ? (
        <Link href="/friends" className="card flex items-center gap-3 p-3 text-sm hover:border-muted">
          <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-surface-2 text-muted">
            <UserPlusIcon size={18} />
          </span>
          <span className="min-w-0">
            <span className="block font-semibold">Voeg vrienden toe</span>
            <span className="block text-xs text-muted">Dan zie je per oefening wie er voor staat.</span>
          </span>
        </Link>
      ) : (
        <ul
          className="-mx-4 flex gap-1 overflow-x-auto px-4 pb-1 [scrollbar-width:none]"
          aria-label="Vrienden en groepsgenoten, op totaalrang"
        >
          {ranked && <SelfChip id={me} name={myName} overall={mine ?? null} />}
          {people.map((p, i) => (
            <PersonChip key={p.id} person={p} index={i} mine={ranked ? (mine ?? null) : undefined} />
          ))}
        </ul>
      )}
    </section>
  );
}

function SelfChip({ id, name, overall }: { id: string; name: string; overall: OverallRank | null }) {
  return (
    <li className="animate-fade-up shrink-0" style={{ order: orderFor(overall?.score ?? null) }}>
      <div className="flex w-16 flex-col items-center gap-1 rounded-xl bg-surface-2/60 py-1">
        <ChipAvatar id={id} name={name} overall={overall} highlight />
        <span className="w-full truncate text-center text-xs font-bold">
          Jij<span className="sr-only">:</span>
        </span>
        <span className="h-3.5 text-[10px] font-semibold text-muted">
          {overall ? `${overall.tier.name}` : "geen rang"}
          {overall?.provisional && <span className="sr-only"> (voorlopig)</span>}
        </span>
      </div>
    </li>
  );
}

function PersonChip({ person, index, mine }: { person: Person; index: number; mine: OverallRank | null | undefined }) {
  const canRank = !!person.bodyweight_kg && !!person.sex;
  const state = useRanksState(
    mine !== undefined && canRank ? person.id : null,
    person.bodyweight_kg ?? null,
    person.sex ?? null,
    ageFrom(person.birth_date),
  );
  const overall = state.data?.overall ?? null;
  const first = person.display_name.split(" ")[0] || person.display_name;
  const loadingRank = mine !== undefined && canRank && state.status === "loading";

  const diff = overall && mine ? overall.score - mine.score : null;
  const relation = diff == null ? null : Math.abs(diff) < TIE ? "gelijk" : diff > 0 ? "hoger" : "lager";
  const label = [
    `${person.display_name}: `,
    mine === undefined ? "" : overall ? `${overall.tier.name}${overall.provisional ? " (voorlopig)" : ""}` : "nog geen rang",
    relation === "hoger"
      ? ", staat hoger dan jij"
      : relation === "lager"
        ? ", staat lager dan jij"
        : relation === "gelijk"
          ? ", gelijk met jou"
          : "",
    ". Ranks vergelijken",
  ].join("");

  return (
    <li
      className="animate-fade-up shrink-0"
      style={
        { "--i": Math.min(index + 1, 8), order: mine === undefined ? undefined : orderFor(overall?.score ?? null) } as React.CSSProperties
      }
    >
      <Link
        href={`/ranks?user=${person.id}`}
        className="flex w-16 flex-col items-center gap-1 rounded-xl py-1 transition hover:bg-surface-2/60 active:scale-95"
        aria-label={label}
      >
        <ChipAvatar id={person.id} name={person.display_name} overall={overall} loading={loadingRank} />
        <span className="w-full truncate text-center text-xs font-medium" aria-hidden>
          {first}
        </span>
        {mine !== undefined && (
          <span
            className={`inline-flex h-3.5 items-center gap-0.5 text-[10px] font-semibold ${
              relation === "lager" ? "text-accent" : relation === "hoger" ? "text-ink" : "text-muted"
            }`}
            aria-hidden
          >
            {loadingRank ? (
              <span className="skeleton h-2.5 w-8 rounded" />
            ) : relation === "hoger" ? (
              <>
                <ArrowUpIcon size={10} /> hoger
              </>
            ) : relation === "lager" ? (
              <>
                <ArrowDownIcon size={10} /> lager
              </>
            ) : relation === "gelijk" ? (
              "gelijk"
            ) : overall ? (
              overall.tier.name
            ) : (
              "geen rang"
            )}
          </span>
        )}
      </Link>
    </li>
  );
}

/** Avatar met de totaalrang als kleine badge rechtsonder. */
function ChipAvatar({
  id,
  name,
  overall,
  loading = false,
  highlight = false,
}: {
  id: string;
  name: string;
  overall: OverallRank | null;
  loading?: boolean;
  highlight?: boolean;
}) {
  return (
    <span className={`relative inline-flex rounded-full ${highlight ? "ring-2 ring-accent/70 ring-offset-2 ring-offset-bg" : ""}`}>
      <Avatar id={id} name={name} size={48} />
      {loading ? (
        <span className="skeleton absolute -bottom-1 -right-1 h-[22px] w-[22px] rounded-full" aria-hidden />
      ) : (
        overall && (
          <span className="absolute -bottom-1 -right-1 rounded-full bg-bg p-[2px]" aria-hidden>
            <RankBadge
              tierIndex={TIERS.indexOf(overall.tier)}
              size={18}
              className={`animate-scale-in ${overall.provisional ? "opacity-70 saturate-50" : ""}`}
            />
          </span>
        )
      )}
    </span>
  );
}
