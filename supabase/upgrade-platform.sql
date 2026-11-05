-- Spotter: meldingsvoorkeuren, idempotente geplande meldingen en het overnemen van een
-- pushabonnement. Veilig om vaker te draaien (alles is "if not exists" / "or replace").
-- Zonder dit script werkt de app gewoon: dan krijgt iedereen alle meldingen (zoals voorheen)
-- en wordt het schakelpaneel voor meldingen in Profiel niet getoond.

-- ─────────── Meldingsvoorkeuren (privé, alleen van jezelf te lezen) ───────────
create table if not exists public.notification_prefs (
  user_id uuid primary key default auth.uid() references public.profiles (id) on delete cascade,
  -- Ochtend "vandaag training" en avond "morgen training gepland".
  plan boolean not null default true,
  -- Avond: training van vandaag nog niet gelogd.
  reminder boolean not null default true,
  -- Zondagavond: weekoverzicht.
  weekly boolean not null default true,
  -- Records en promoties van groepsleden.
  activity boolean not null default true,
  updated_at timestamptz not null default now()
);

alter table public.notification_prefs enable row level security;
drop policy if exists "notification prefs own" on public.notification_prefs;
create policy "notification prefs own" on public.notification_prefs for all to authenticated
  using (user_id = auth.uid()) with check (user_id = auth.uid());
grant select, insert, update, delete on public.notification_prefs to authenticated;

-- ─────────── Logboek van geplande meldingen (alleen de server) ───────────
-- Voorkomt dubbele meldingen als de cron opnieuw of dubbel draait: per persoon, soort en dag
-- maximaal één melding.
create table if not exists public.push_log (
  user_id uuid not null references public.profiles (id) on delete cascade,
  kind text not null,
  day date not null,
  sent_at timestamptz not null default now(),
  primary key (user_id, kind, day)
);
alter table public.push_log enable row level security;
-- Geen policies: alleen de server (secret key) leest en schrijft hier.
revoke all on public.push_log from anon, authenticated;
create index if not exists push_log_day on public.push_log (day);

-- ─────────── Pushabonnement overnemen ───────────
-- Als iemand anders eerder op dit toestel was ingelogd, hoort het endpoint nog bij die persoon en
-- zou een gewone upsert op RLS stuklopen. Deze functie zet het abonnement op naam van wie nu
-- ingelogd is (alleen voor dit ene endpoint, dat alleen dit toestel kent).
create or replace function public.claim_push_subscription(p_endpoint text, p_p256dh text, p_auth text)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if auth.uid() is null then
    raise exception 'not authenticated' using errcode = '42501';
  end if;
  if coalesce(p_endpoint, '') !~ '^https://' or length(p_endpoint) > 2048 then
    raise exception 'invalid endpoint' using errcode = '22023';
  end if;
  insert into public.push_subscriptions (endpoint, user_id, p256dh, auth)
  values (p_endpoint, auth.uid(), p_p256dh, p_auth)
  on conflict (endpoint) do update
    set user_id = auth.uid(), p256dh = excluded.p256dh, auth = excluded.auth;
end;
$$;

revoke all on function public.claim_push_subscription(text, text, text) from public, anon;
grant execute on function public.claim_push_subscription(text, text, text) to authenticated;

-- ─────────── Voeding blijft privé: eigen profiel via een functie ───────────
-- profiles bevat ook voedingsdoelen (kcal_target, protein_target, carbs_target, fat_target,
-- nutrition_goal, activity_level). Andermans profiel wordt in de app alleen nog met de openbare
-- kolommen opgevraagd (PUBLIC_PROFILE_COLUMNS in src/lib/types.ts); je eigen volledige profiel
-- komt via deze functie, die alleen jouw eigen rij teruggeeft.
create or replace function public.get_my_profile()
returns setof public.profiles
language sql
stable
security definer
set search_path = public
as $$
  select * from public.profiles where id = auth.uid();
$$;

revoke all on function public.get_my_profile() from public, anon;
grant execute on function public.get_my_profile() to authenticated;

-- STAP 2 (pas draaien als de hele app is bijgewerkt, zie hieronder): de voedingskolommen van
-- profiles afschermen voor andere gebruikers. Daarna mag geen enkel scherm nog select("*") of
-- profiles(*) op profiles doen (eigen profiel: fetchOwnProfile, anderen: PUBLIC_PROFILE_COLUMNS),
-- en mag een update op profiles geen voedingskolommen meer teruglezen met .select().
-- Haal de commentaartekens weg en draai dit blok:
--
-- revoke select on public.profiles from authenticated, anon;
-- grant select (id, display_name, created_at, bodyweight_kg, sex, height_cm, birth_date, weekly_goal, friend_code)
--   on public.profiles to authenticated;
--
-- Terugdraaien kan altijd met: grant select on public.profiles to authenticated;
