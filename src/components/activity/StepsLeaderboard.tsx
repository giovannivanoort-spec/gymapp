"use client";

import Link from "next/link";
import { useState } from "react";
import { Avatar } from "@/components/Avatar";
import { ConsentSheet } from "@/components/activity/ConsentSheet";
import { StepsIcon } from "@/components/activity/icons";
import { ConfirmSheet } from "@/components/social/ConfirmSheet";
import { ErrorState } from "@/components/ui/States";
import { toast } from "@/components/ui/Toast";
import {
  LEADERBOARD_DAY_GOAL,
  saveActivitySettings,
  useActivitySettings,
  useStepsLeaderboard,
  type LeaderboardScope,
  type StepsLeaderboardEntry,
} from "@/lib/activity";
import { formatWeekRange } from "@/lib/week";

const fmt = (n: number) => Math.round(n).toLocaleString("nl-NL");

/**
 * Ranglijst stappen van deze week (maandag t/m zondag) voor je vrienden of een groep. Alleen op
 * stappen, nooit op kcal. Wie niet deelt staat er niet in; zelf zie je de lijst pas als je
 * ook deelt (wederkerigheid, afgedwongen door de server: activity_steps_for). "Dagen 7.000+"
 * gebruikt een vaste grens: andermans doel is privé.
 */
export function StepsLeaderboard({ userId, scope }: { userId: string; scope: LeaderboardScope }) {
  const uid = userId || null;
  const settingsS = useActivitySettings(uid);
  const settings = settingsS.data;
  const sharing = !!settings?.consented && settings.share_activity;
  const boardS = useStepsLeaderboard(scope, sharing ? uid : null);
  const board = boardS.data;
  const [consentOpen, setConsentOpen] = useState(false);
  const [shareOpen, setShareOpen] = useState(false);

  const isGroup = scope.scope === "group";
  const who = isGroup ? "groepsgenoten" : "vrienden";
  const headingId = isGroup ? `steps-h-${scope.groupId}` : "steps-h-friends";

  let content: React.ReactNode;
  if (!settings) {
    content = settingsS.error ? (
      <ErrorState compact title="Stappen niet geladen" message="De stappenranglijst kon niet geladen worden." onRetry={settingsS.retry} />
    ) : (
      <div className="skeleton h-[120px]" aria-label="Stappen laden" />
    );
  } else if (!settings.available || board?.available === false) {
    content = <Calm text="De stappenranglijst is nog niet ingeschakeld in deze app." />;
  } else if (!settings.consented) {
    content = (
      <Cta
        title="Doe mee met stappen"
        text={`Houd je dagelijkse stappen bij en deel ze om te zien hoeveel je ${who} lopen.`}
        label="Stappen bijhouden"
        onClick={() => setConsentOpen(true)}
      />
    );
  } else if (!settings.share_activity) {
    content = (
      <Cta
        title="Deel je stappen om de ranglijst te zien"
        text={`Je ziet de stappen van je ${who} zodra jij die van jou ook deelt.`}
        label="Stappen delen"
        onClick={() => setShareOpen(true)}
      />
    );
  } else if (!board) {
    content = boardS.error ? (
      <ErrorState compact title="Ranglijst niet geladen" message="De stappen van deze week konden niet geladen worden." onRetry={boardS.retry} />
    ) : (
      <div className="skeleton h-[120px]" aria-label="Ranglijst laden" />
    );
  } else if (board.entries.length === 0) {
    content = <Calm text="Nog geen stappen deze week. Voer je stappen in op Home." />;
  } else {
    const top = board.entries[0].totalSteps || 1;
    content = (
      <ol className="card animate-fade-up divide-y divide-line p-0">
        {board.entries.map((e, i) => (
          <li key={e.user_id} className="animate-fade-up" style={{ "--i": Math.min(i, 8) } as React.CSSProperties}>
            {e.isMe || isGroup ? (
              <div className={`flex items-center gap-3 px-4 py-2.5 ${e.isMe ? "bg-accent/[0.04]" : ""}`}>
                <Row e={e} top={top} />
              </div>
            ) : (
              <Link href={`/friends/${e.user_id}`} className="flex items-center gap-3 px-4 py-2.5 transition hover:bg-surface-2/40">
                <Row e={e} top={top} />
              </Link>
            )}
          </li>
        ))}
      </ol>
    );
  }

  return (
    <section className="space-y-3" aria-labelledby={headingId}>
      <div className="flex items-baseline justify-between gap-3">
        <h2 id={headingId} className="text-sm font-semibold uppercase tracking-wide text-muted">
          Stappen deze week
        </h2>
        {board && sharing && <span className="text-xs text-muted">{formatWeekRange(board.week)}</span>}
      </div>
      {content}
      {sharing && board?.available && (
        <p className="px-1 text-xs text-muted">
          Alleen {who} die delen staan erin. Dagen {fmt(LEADERBOARD_DAY_GOAL)}+ is het aantal dagen met minstens {fmt(LEADERBOARD_DAY_GOAL)}{" "}
          stappen.
        </p>
      )}

      {uid && (
        <>
          <ConsentSheet
            open={consentOpen}
            onClose={() => setConsentOpen(false)}
            userId={uid}
            onConsented={() => {
              setConsentOpen(false);
              setShareOpen(true);
            }}
          />
          <ConfirmSheet
            open={shareOpen}
            onClose={() => setShareOpen(false)}
            title="Stappen delen?"
            body={
              <div className="space-y-2">
                <p>
                  Je vrienden en de leden van je groepen zien dan je stappen per dag (niet je kcal), als zij ook delen. Ook trainers in je groepen
                  zien ze.
                </p>
                <p>Uitzetten kan altijd in Profiel, onder Koppelingen.</p>
              </div>
            }
            confirmLabel="Delen"
            onConfirm={async () => {
              await saveActivitySettings(uid, { share: true });
              setShareOpen(false);
              toast.success("Je stappen worden nu gedeeld");
            }}
          />
        </>
      )}
    </section>
  );
}

function Row({ e, top }: { e: StepsLeaderboardEntry; top: number }) {
  const name = e.isMe ? "Jij" : (e.profile?.display_name ?? "Onbekend");
  const pct = Math.max(4, (e.totalSteps / top) * 100);
  return (
    <>
      <span className={`w-4 shrink-0 text-center text-xs font-bold tabular-nums ${e.rank === 1 ? "text-accent" : "text-muted"}`}>{e.rank}</span>
      <Avatar id={e.user_id} name={e.profile?.display_name ?? name} src={e.profile?.avatar_url} size={32} />
      <div className="min-w-0 flex-1 space-y-1">
        <p className="flex min-w-0 items-center gap-1.5">
          <span className={`truncate text-sm ${e.isMe ? "font-bold" : "font-semibold"}`}>{name}</span>
          {e.manual && <span className="chip shrink-0 px-1.5 py-0 text-[10px]">handmatig</span>}
        </p>
        <div className="h-1.5 overflow-hidden rounded-full bg-surface-2" aria-hidden>
          <div
            className={`h-full rounded-full ${e.rank === 1 ? "bg-accent" : "bg-accent/50"}`}
            style={{ width: `${pct}%`, transition: "width 0.6s cubic-bezier(0.2,0.8,0.2,1)" }}
          />
        </div>
        <p className="text-[11px] tabular-nums text-muted">
          gem. {fmt(e.avgSteps)} per dag · {e.daysGoalMet} {e.daysGoalMet === 1 ? "dag" : "dagen"} {fmt(LEADERBOARD_DAY_GOAL)}+
        </p>
      </div>
      <span className="shrink-0 text-right text-sm font-bold tabular-nums">
        {fmt(e.totalSteps)}
        <span className="sr-only"> stappen deze week</span>
      </span>
    </>
  );
}

function Calm({ text }: { text: string }) {
  return (
    <div className="card animate-fade-in flex items-center gap-3 py-3 text-sm text-muted">
      <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-surface-2">
        <StepsIcon size={18} />
      </span>
      <p className="min-w-0 flex-1">{text}</p>
    </div>
  );
}

function Cta({ title, text, label, onClick }: { title: string; text: string; label: string; onClick: () => void }) {
  return (
    <div className="card animate-fade-up flex flex-col gap-3 sm:flex-row sm:items-center">
      <div className="flex min-w-0 flex-1 items-center gap-3">
        <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-accent/15 text-accent">
          <StepsIcon size={20} />
        </span>
        <div className="min-w-0">
          <p className="text-sm font-semibold">{title}</p>
          <p className="text-xs text-muted">{text}</p>
        </div>
      </div>
      <button type="button" className="btn-primary w-full shrink-0 sm:w-auto" onClick={onClick}>
        {label}
      </button>
    </div>
  );
}
