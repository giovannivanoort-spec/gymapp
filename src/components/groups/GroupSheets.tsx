"use client";

import Link from "next/link";
import { useState } from "react";
import { Avatar } from "@/components/Avatar";
import { ChevronRightIcon } from "@/components/Icons";
import { Sheet } from "@/components/Sheet";
import { errorMessage, supabase } from "@/lib/supabase";
import type { Group, GroupMember } from "@/lib/types";
import { ConfirmSheet } from "./ConfirmSheet";
import { memberName } from "./groupData";

function friendlyError(err: unknown): string {
  const msg = errorMessage(err);
  if (/failed to fetch|network|load failed/i.test(msg)) return "Geen verbinding. Probeer het opnieuw.";
  if (/row-level security|permission|42501/i.test(msg)) return "Dat mag alleen een trainer van deze groep.";
  return msg;
}

/* ─────────────── Lid beheren (alleen trainers) ─────────────── */

export function MemberSheet({
  member,
  groupId,
  onClose,
  onChanged,
}: {
  member: GroupMember;
  groupId: string;
  onClose: () => void;
  onChanged: (message: string) => void;
}) {
  const [busy, setBusy] = useState(false);
  const [confirmRemove, setConfirmRemove] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const name = memberName(member);
  const isTrainer = member.role === "trainer";

  async function toggleRole() {
    setBusy(true);
    setError(null);
    const role = isTrainer ? "member" : "trainer";
    const { error } = await supabase.from("group_members").update({ role }).eq("group_id", groupId).eq("user_id", member.user_id);
    setBusy(false);
    if (error) return setError(friendlyError(error));
    onChanged(role === "trainer" ? `${name} is nu trainer` : `${name} is nu lid`);
  }

  async function remove() {
    setBusy(true);
    setError(null);
    const { error } = await supabase.from("group_members").delete().eq("group_id", groupId).eq("user_id", member.user_id);
    setBusy(false);
    if (error) return setError(friendlyError(error));
    onChanged(`${name} is uit de groep verwijderd`);
  }

  return (
    <Sheet open onClose={busy ? () => {} : onClose} title={name}>
      <div className="space-y-4">
        <div className="flex items-center gap-3">
          <Avatar id={member.user_id} name={name} src={member.profiles?.avatar_url} size={48} />
          <div className="min-w-0">
            <p className="truncate font-semibold">{name}</p>
            <p className={`text-sm ${isTrainer ? "text-accent" : "text-muted"}`}>{isTrainer ? "Trainer" : "Lid"}</p>
          </div>
        </div>

        <Link
          href={`/ranks?user=${member.user_id}`}
          className="flex min-h-11 items-center justify-between rounded-xl border border-line bg-surface-2 px-4 py-3 text-sm font-medium hover:border-muted"
        >
          Ranks en records bekijken
          <ChevronRightIcon className="text-muted" />
        </Link>

        {error && (
          <p role="alert" className="rounded-xl border border-danger/30 bg-danger/10 px-3 py-2 text-sm text-danger">
            {error}
          </p>
        )}

        {confirmRemove ? (
          <div className="animate-fade-in space-y-3 rounded-2xl border border-danger/30 p-4">
            <p className="text-sm">
              <span className="font-semibold">{name}</span> uit de groep verwijderen? Diegene ziet de trainingen en activiteit van
              deze groep dan niet meer, en kan alleen via een nieuwe uitnodiging terugkomen.
            </p>
            <div className="grid grid-cols-2 gap-2">
              <button className="btn-ghost min-h-11" onClick={() => setConfirmRemove(false)} disabled={busy}>
                Annuleren
              </button>
              <button className="btn-danger min-h-11" onClick={remove} disabled={busy}>
                {busy ? "Bezig…" : "Verwijderen"}
              </button>
            </div>
          </div>
        ) : (
          <div className="grid grid-cols-1 gap-2">
            <button className="btn-ghost min-h-11" onClick={toggleRole} disabled={busy}>
              {busy ? "Bezig…" : isTrainer ? "Maak gewoon lid" : "Maak trainer"}
            </button>
            <p className="px-1 text-xs text-muted">
              {isTrainer
                ? "Een lid kan zelf sets loggen, maar geen trainingen plannen of leden beheren."
                : "Een trainer kan trainingen plannen, sets voor anderen invullen en leden beheren."}
            </p>
            <button className="btn-danger mt-2 min-h-11" onClick={() => setConfirmRemove(true)} disabled={busy}>
              Uit groep verwijderen
            </button>
          </div>
        )}
      </div>
    </Sheet>
  );
}

/* ─────────────── Groep verlaten (met overdracht als je de enige trainer bent) ─────────────── */

/**
 * Verlaten (en zo nodig eerst overdragen) in één transactie via de RPC leave_group. Zonder die
 * functie (upgrade-groups.sql niet gedraaid) in twee stappen, als terugval.
 */
async function leaveGroup(groupId: string, userId: string, successor: string | null) {
  const { error } = await supabase.rpc("leave_group", { gid: groupId, successor });
  if (!error) return;
  const missing = error.code === "PGRST202" || error.code === "42883" || /could not find the function/i.test(error.message);
  if (!missing) throw error;
  if (successor) {
    const promote = await supabase.from("group_members").update({ role: "trainer" }).eq("group_id", groupId).eq("user_id", successor);
    if (promote.error) throw promote.error;
  }
  const left = await supabase.from("group_members").delete().eq("group_id", groupId).eq("user_id", userId);
  if (left.error) throw left.error;
}

export function LeaveSheet({
  groupId,
  members,
  userId,
  onClose,
  onLeft,
}: {
  groupId: string;
  members: GroupMember[];
  userId: string;
  onClose: () => void;
  /** Na verlaten; `deleted` als de groep daarbij is verwijderd (je was het enige lid en trainer). */
  onLeft: (deleted: boolean) => void;
}) {
  const me = members.find((m) => m.user_id === userId);
  const others = members.filter((m) => m.user_id !== userId);
  const otherTrainers = others.filter((m) => m.role === "trainer");
  const mode: "alone" | "handover" | "normal" =
    others.length === 0 ? "alone" : me?.role === "trainer" && otherTrainers.length === 0 ? "handover" : "normal";

  const [picked, setPicked] = useState<string | null>(null);
  // Ledenlijst kan intussen ververst zijn: een gekozen opvolger die weg is, telt niet meer.
  const successor = picked && others.some((m) => m.user_id === picked) ? picked : null;
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function confirm() {
    if (mode === "handover" && !successor) return;
    setBusy(true);
    setError(null);
    const deletes = mode === "alone" && me?.role === "trainer";
    try {
      if (deletes) {
        const { data: deleted, error } = await supabase.from("groups").delete().eq("id", groupId).select("id");
        if (error) throw error;
        // Niets verwijderd zonder fout: RLS weigerde stil (bijv. je rol is intussen veranderd).
        if (!deleted?.length) throw new Error("De groep kon niet worden verwijderd. Vernieuw de pagina en probeer het opnieuw.");
      } else {
        await leaveGroup(groupId, userId, mode === "handover" ? successor : null);
      }
      onLeft(deletes);
    } catch (err) {
      setError(friendlyError(err));
      setBusy(false);
    }
  }

  return (
    <ConfirmSheet
      open
      title={mode === "alone" ? "Groep verwijderen?" : "Groep verlaten?"}
      danger
      busy={busy}
      error={error}
      confirmDisabled={mode === "handover" && !successor}
      confirmLabel={mode === "alone" ? "Verwijderen" : mode === "handover" ? "Overdragen en verlaten" : "Verlaten"}
      onConfirm={confirm}
      onClose={onClose}
      body={
        mode === "alone"
          ? "Je bent het enige lid. Als je de groep verlaat, worden de groep, alle trainingen en je gelogde sets daarin definitief verwijderd."
          : mode === "handover"
            ? "Je bent de enige trainer. Kies eerst wie de groep overneemt, zodat er nog iemand trainingen kan plannen. Je eigen sets, records en ranks blijven bewaard."
            : "Je ziet de trainingen, activiteit en ranglijst van deze groep dan niet meer. Je eigen sets, records en ranks blijven bewaard. Terugkomen kan via een nieuwe uitnodiging."
      }
    >
      {mode === "handover" && (
        <ul className="space-y-2" role="radiogroup" aria-label="Nieuwe trainer">
          {others.map((m) => {
            const selected = successor === m.user_id;
            return (
              <li key={m.user_id}>
                <button
                  role="radio"
                  aria-checked={selected}
                  onClick={() => setPicked(m.user_id)}
                  className={`flex min-h-12 w-full items-center gap-3 rounded-xl border px-3 py-2 text-left transition active:scale-[0.99] ${
                    selected ? "border-accent bg-accent/10" : "border-line bg-surface-2 hover:border-muted"
                  }`}
                >
                  <Avatar id={m.user_id} name={memberName(m)} src={m.profiles?.avatar_url} size={32} />
                  <span className="min-w-0 flex-1 truncate text-sm font-medium">{memberName(m)}</span>
                  <span
                    className={`h-4 w-4 shrink-0 rounded-full border-2 ${selected ? "border-accent bg-accent" : "border-line"}`}
                    aria-hidden
                  />
                </button>
              </li>
            );
          })}
        </ul>
      )}
    </ConfirmSheet>
  );
}

/* ─────────────── Groepsinstellingen: naam en uitnodigingslink ─────────────── */

function newInviteCode(): string {
  const bytes = new Uint8Array(4);
  crypto.getRandomValues(bytes);
  return [...bytes].map((b) => b.toString(16).padStart(2, "0")).join("");
}

export function GroupSettingsSheet({
  group,
  onClose,
  onChanged,
}: {
  group: Group;
  onClose: () => void;
  onChanged: (message: string) => void;
}) {
  const [name, setName] = useState(group.name);
  const [busy, setBusy] = useState<"name" | "code" | null>(null);
  const [confirmCode, setConfirmCode] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const trimmed = name.trim();

  async function saveName(e: React.FormEvent) {
    e.preventDefault();
    if (!trimmed || trimmed === group.name) return;
    setBusy("name");
    setError(null);
    const { error } = await supabase.from("groups").update({ name: trimmed }).eq("id", group.id);
    setBusy(null);
    if (error) return setError(friendlyError(error));
    onChanged("Groepsnaam opgeslagen");
  }

  async function resetCode() {
    setBusy("code");
    setError(null);
    const { error } = await supabase.from("groups").update({ invite_code: newInviteCode() }).eq("id", group.id);
    setBusy(null);
    if (error) return setError(friendlyError(error));
    onChanged("Nieuwe uitnodigingslink gemaakt");
  }

  return (
    <Sheet open onClose={busy ? () => {} : onClose} title="Groepsinstellingen">
      <div className="space-y-6">
        <form onSubmit={saveName} className="space-y-2">
          <label className="label" htmlFor="group-name">
            Naam
          </label>
          <div className="flex gap-2">
            <input
              id="group-name"
              className="input"
              value={name}
              maxLength={60}
              onChange={(e) => setName(e.target.value)}
              autoComplete="off"
            />
            <button className="btn-primary shrink-0" disabled={!trimmed || trimmed === group.name || busy !== null}>
              {busy === "name" ? "Bezig…" : "Opslaan"}
            </button>
          </div>
        </form>

        <div className="space-y-2">
          <p className="label">Uitnodigingslink</p>
          <p className="text-sm text-muted">
            Is de link in verkeerde handen gekomen? Maak een nieuwe. De oude link en code werken daarna niet meer; huidige leden
            blijven gewoon lid.
          </p>
          {confirmCode ? (
            <div className="animate-fade-in grid grid-cols-2 gap-2">
              <button className="btn-ghost min-h-11" onClick={() => setConfirmCode(false)} disabled={busy !== null}>
                Annuleren
              </button>
              <button className="btn-danger min-h-11" onClick={resetCode} disabled={busy !== null}>
                {busy === "code" ? "Bezig…" : "Nieuwe link maken"}
              </button>
            </div>
          ) : (
            <button className="btn-ghost min-h-11 w-full" onClick={() => setConfirmCode(true)} disabled={busy !== null}>
              Nieuwe link maken
            </button>
          )}
        </div>

        {error && (
          <p role="alert" className="rounded-xl border border-danger/30 bg-danger/10 px-3 py-2 text-sm text-danger">
            {error}
          </p>
        )}
      </div>
    </Sheet>
  );
}
