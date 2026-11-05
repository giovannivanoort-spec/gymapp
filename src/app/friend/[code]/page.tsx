"use client";

import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { AppShell } from "@/components/AppShell";
import { useUserId } from "@/components/AuthProvider";
import { Avatar } from "@/components/Avatar";
import { CheckIcon, UserPlusIcon } from "@/components/Icons";
import { RetryIcon } from "@/components/social/icons";
import {
  friendErrorMessage,
  REQUEST_MESSAGES,
  requestFriendByCode,
  useFriends,
  useFriendsRealtime,
  useFriendsStatus,
} from "@/lib/friends";
import { fetchAvatarUrl } from "@/lib/avatars";
import { useCached } from "@/lib/cache";
import { supabase } from "@/lib/supabase";

/** Zo lang wachten we maximaal op de vriendenlijst voordat we de uitnodiging toch tonen. */
const FRIENDS_WAIT_MS = 2500;

type Preview = { id: string; display_name: string };
type Loaded = { code: string; attempt: number; preview: Preview | null } | { code: string; attempt: number; error: true };

/** Uitnodigingslink voor een vriendschap: /friend/<code>. */
export default function FriendInvitePage() {
  const { code } = useParams<{ code: string }>();
  const me = useUserId();
  const router = useRouter();
  const friends = useFriends(me);
  const friendsStatus = useFriendsStatus(me);
  useFriendsRealtime(me);
  const [waited, setWaited] = useState(false);
  const [attempt, setAttempt] = useState(0);
  const [loaded, setLoaded] = useState<Loaded | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    supabase.rpc("friend_code_preview", { code }).then(({ data, error }) => {
      if (cancelled) return;
      if (error) setLoaded({ code, attempt, error: true });
      else setLoaded({ code, attempt, preview: (data as Preview[] | null)?.[0] ?? null });
    });
    return () => {
      cancelled = true;
    };
  }, [code, attempt]);

  // Niet eeuwig wachten op de vriendenlijst (bijv. offline): na even toch de uitnodiging tonen.
  useEffect(() => {
    const t = setTimeout(() => setWaited(true), FRIENDS_WAIT_MS);
    return () => clearTimeout(t);
  }, []);

  // Alleen het resultaat van de huidige code en poging tonen.
  const current = loaded && loaded.code === code && loaded.attempt === attempt ? loaded : null;
  const preview = current && !("error" in current) ? current.preview : undefined;
  const alreadyFriends = !!preview && !!friends?.friends.some((f) => f.id === preview.id);
  const requested = !!preview && !!friends?.outgoing.some((f) => f.id === preview.id);
  const askedYou = !!preview && !!friends?.incoming.some((f) => f.id === preview.id);
  // Eerst weten of jullie al vrienden zijn, anders springt "Vriend toevoegen" om naar "al vrienden".
  const friendsKnown = waited || friendsStatus.error || (friends !== undefined && friendsStatus.verified);
  const waitingForFriends = !!preview && preview.id !== me && !friendsKnown;
  const first = preview?.display_name.split(" ")[0] ?? "";
  // Profielfoto apart ophalen (de preview-functie geeft alleen id en naam); mislukt het, dan initialen.
  const photo = useCached(preview ? `avatar:${preview.id}` : null, () => fetchAvatarUrl(preview!.id).catch(() => null));

  async function add() {
    if (!preview) return;
    setBusy(true);
    setError(null);
    try {
      // Wacht tot de vriendenlijst ververst is, zodat het profiel direct opent (geen "geen vrienden").
      const res = await requestFriendByCode(code, preview.id);
      if (res === "accepted" || res === "already") {
        router.replace(`/friends/${preview.id}`);
        return;
      }
      setDone(REQUEST_MESSAGES[res]);
    } catch (err) {
      setError(friendErrorMessage(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <AppShell title="Vriendschapsverzoek" back="/">
      {!current || waitingForFriends ? (
        <div className="card flex flex-col items-center gap-4 py-8" aria-busy>
          <span className="skeleton h-20 w-20 rounded-full" />
          <span className="skeleton h-6 w-40" />
          <span className="skeleton h-4 w-56" />
          <span className="skeleton mt-2 h-11 w-full" />
        </div>
      ) : "error" in current ? (
        <div className="card space-y-3 text-center">
          <p className="text-sm text-muted">Kon de uitnodiging niet laden. Controleer je verbinding.</p>
          <button className="btn-ghost w-full" onClick={() => setAttempt((a) => a + 1)}>
            <RetryIcon size={15} /> Opnieuw proberen
          </button>
        </div>
      ) : preview === null ? (
        <div className="card animate-fade-up space-y-3 text-center">
          <p className="font-semibold">Deze vriendcode bestaat niet</p>
          <p className="text-sm text-muted">Controleer de link of vraag je vriend om een nieuwe.</p>
          <Link href="/friends" className="btn-ghost w-full">
            Naar vrienden
          </Link>
        </div>
      ) : preview!.id === me ? (
        <div className="card animate-fade-up space-y-3 text-center text-sm text-muted">
          <p>Dit is je eigen link. Stuur hem naar een vriend zodat die jou kan toevoegen.</p>
          <Link href="/friends" className="btn-ghost w-full">
            Naar vrienden
          </Link>
        </div>
      ) : (
        <div className="card animate-scale-in relative space-y-5 overflow-hidden py-8 text-center">
          <div className="pointer-events-none absolute left-1/2 top-0 h-40 w-40 -translate-x-1/2 -translate-y-1/2 rounded-full bg-accent/15 blur-3xl" />
          <Avatar id={preview!.id} name={preview!.display_name} src={photo} size={80} className="relative mx-auto" ring={alreadyFriends ? "var(--color-accent)" : undefined} />
          <div className="relative">
            <h2 className="text-2xl font-bold">{preview!.display_name}</h2>
            <p className="mt-1 text-sm text-muted">
              {alreadyFriends
                ? `Jij en ${first} zijn al vrienden.`
                : askedYou
                  ? `${first} heeft je al een vriendschapsverzoek gestuurd. Accepteer het en jullie zien elkaars trainingen, ranks en progressie.`
                  : `${first} heeft je uitgenodigd om vrienden te worden. Dan zien jullie elkaars trainingen, ranks en progressie.`}
            </p>
            {!alreadyFriends && <p className="mt-1 text-xs text-muted">Voeding blijft altijd privé.</p>}
            {requested && !alreadyFriends && !askedYou && !done && (
              <p className="mx-auto mt-3 flex max-w-xs items-start justify-center gap-1.5 text-xs font-semibold text-accent">
                <CheckIcon size={13} className="mt-px shrink-0" />
                <span>Je stuurde al een verzoek. Met deze link zijn jullie meteen vrienden.</span>
              </p>
            )}
          </div>
          {error && (
            <p role="alert" className="relative text-sm text-danger">
              {error}
            </p>
          )}
          {alreadyFriends ? (
            <Link href={`/friends/${preview!.id}`} className="btn-primary relative w-full">
              Bekijk profiel
            </Link>
          ) : done ? (
            <div className="relative space-y-3">
              <p className="flex items-center justify-center gap-1.5 font-semibold text-accent">
                <CheckIcon size={16} /> {done}
              </p>
              <Link href="/friends" className="btn-ghost w-full">
                Naar vrienden
              </Link>
            </div>
          ) : (
            <button className="btn-primary relative w-full" onClick={add} disabled={busy} aria-busy={busy}>
              {askedYou ? <CheckIcon size={16} /> : <UserPlusIcon size={16} />}{" "}
              {busy ? (askedYou ? "Accepteren…" : "Toevoegen…") : askedYou ? "Accepteren" : "Vriend toevoegen"}
            </button>
          )}
        </div>
      )}
    </AppShell>
  );
}
