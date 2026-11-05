-- Activiteit: dagelijkse stappen en actieve kcal (handmatig, later ook Health Connect / Apple Health).
-- Plak dit in Supabase → SQL Editor → New query → Run, na friends.sql en upgrade-social.sql (en features.sql,
-- voor shares_group). Veilig om opnieuw te draaien.
--
-- Zonder dit script werkt de app gewoon; onderdelen voor activiteit tonen dan "nog niet ingeschakeld".
--
-- Privacy (gezondheidsgegevens, AVG art. 9):
-- - Niets wordt opgeslagen zonder uitdrukkelijke toestemming (activity_settings.health_consent_at).
-- - Toestemming intrekken verwijdert direct alle activiteitsgegevens en zet delen en de coach uit.
-- - Elke wijziging in toestemming wordt vastgelegd in activity_consent_log (alleen toevoegen).
-- - Delen met vrienden en groepsgenoten en gebruik door de AI-coach zijn aparte, losse toestemmingen.
-- - De tabellen zelf tonen alleen je eigen rijen. Vrienden en groepsgenoten zien alleen stappen per dag
--   (en of het handmatig was), via activity_steps_for, en alleen als zij en jij allebei delen.
-- - Schrijven gaat uitsluitend via de functies hieronder (met controle op bereik en datum).
-- - Account verwijderen ruimt alles op via "on delete cascade" op profiles.
--
-- Versie van de toestemmingstekst: 'activiteit-v1-2026-11'. Pas die alleen samen met
-- ACTIVITY_CONSENT_VERSION in src/lib/activity.ts aan.

-- ─────────────── Instellingen en toestemmingen (privé, alleen je eigen rij) ───────────────
create table if not exists public.activity_settings (
  user_id uuid primary key references public.profiles (id) on delete cascade,
  health_consent_at timestamptz,               -- null = geen toestemming om activiteit op te slaan
  consent_version text,
  share_activity boolean not null default false,
  share_activity_at timestamptz,
  coach_activity boolean not null default false,
  coach_activity_at timestamptz,
  step_goal int not null default 7000 check (step_goal between 1000 and 50000),
  burn_credit_pct smallint not null default 0 check (burn_credit_pct in (0, 25, 50, 75, 100)),
  updated_at timestamptz not null default now(),
  constraint activity_settings_share_needs_consent check (not share_activity or health_consent_at is not null),
  constraint activity_settings_coach_needs_consent check (not coach_activity or health_consent_at is not null)
);
alter table public.activity_settings enable row level security;
drop policy if exists "activity settings read own" on public.activity_settings;
create policy "activity settings read own" on public.activity_settings for select to authenticated
  using (user_id = auth.uid());
-- Schrijven alleen via save_activity_settings.
revoke insert, update, delete, truncate on public.activity_settings from authenticated, anon;
revoke all on public.activity_settings from anon;
grant select on public.activity_settings to authenticated;

-- ─────────────── Bewijs van toestemming (alleen toevoegen) ───────────────
create table if not exists public.activity_consent_log (
  id bigint generated always as identity primary key,
  user_id uuid not null references public.profiles (id) on delete cascade,
  scope text not null check (scope in ('store', 'share', 'coach')),
  granted boolean not null,
  version text not null,
  at timestamptz not null default now()
);
create index if not exists activity_consent_log_user on public.activity_consent_log (user_id, at desc);
alter table public.activity_consent_log enable row level security;
drop policy if exists "consent log read own" on public.activity_consent_log;
create policy "consent log read own" on public.activity_consent_log for select to authenticated
  using (user_id = auth.uid());
revoke insert, update, delete, truncate on public.activity_consent_log from authenticated, anon;
revoke all on public.activity_consent_log from anon;
grant select on public.activity_consent_log to authenticated;

-- ─────────────── Dagtotalen: één rij per gebruiker × lokale datum × bron ───────────────
create table if not exists public.daily_activity (
  user_id uuid not null references public.profiles (id) on delete cascade,
  date date not null,                            -- LOKALE kalenderdag van het toestel (geen UTC)
  source text not null check (source in ('manual', 'health_connect', 'healthkit', 'garmin', 'shortcut')),
  steps int check (steps between 0 and 100000),
  active_kcal int check (active_kcal between 0 and 10000),   -- kcal door beweging, zonder ruststofwisseling
  total_kcal int check (total_kcal between 0 and 15000),     -- incl. ruststofwisseling; optioneel, niet voor ranglijst of doelen
  source_apps text[] not null default '{}' check (cardinality(source_apps) <= 10),  -- bv. {com.garmin.android.apps.connectmobile}
  tz text check (tz is null or length(tz) <= 64),            -- IANA-tijdzone van het toestel bij synchroniseren (ter info)
  synced_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  primary key (user_id, date, source),
  check (steps is not null or active_kcal is not null or total_kcal is not null)
);
create index if not exists daily_activity_date on public.daily_activity (date, user_id);

alter table public.daily_activity enable row level security;
-- Lezen en verwijderen: alleen je eigen dagen. Vrienden en groepsgenoten lezen nooit rechtstreeks
-- (dan zouden ze ook tijdzone, totale kcal en apps zien), maar via activity_steps_for hieronder.
drop policy if exists "activity read" on public.daily_activity;
create policy "activity read" on public.daily_activity for select to authenticated
  using (user_id = auth.uid());
drop policy if exists "activity delete own" on public.daily_activity;
create policy "activity delete own" on public.daily_activity for delete to authenticated
  using (user_id = auth.uid());
-- Toevoegen en wijzigen alleen via upsert_daily_activity.
revoke insert, update, truncate on public.daily_activity from authenticated, anon;
revoke all on public.daily_activity from anon;
grant select, delete on public.daily_activity to authenticated;

-- Hulpfunctie uit een eerdere versie van dit script: liet iedereen zien wie deelt. Niet meer nodig.
drop function if exists public.activity_shared(uuid);

-- ─────────────── Eén effectieve waarde per dag: bronnen worden NOOIT opgeteld ───────────────
-- Voorrang: telefoon/horloge via Health Connect of Apple Health > Garmin > snelkoppeling > handmatig.
-- Een rij zonder stappen (of 0 stappen van Apple Health = niet gemeten) komt achteraan, zodat een
-- handmatige invoer met stappen dan wel telt.
-- security_invoker: de leesregel van daily_activity geldt ook hier (dus alleen je eigen dagen).
create or replace view public.daily_activity_effective with (security_invoker = true) as
select distinct on (user_id, date)
  user_id, date, source, steps, active_kcal, total_kcal, source_apps, synced_at
from public.daily_activity
order by user_id, date,
  (steps is null or (source = 'healthkit' and steps = 0)),
  case source when 'health_connect' then 1 when 'healthkit' then 1 when 'garmin' then 2
              when 'shortcut' then 3 else 9 end,
  synced_at desc;
revoke all on public.daily_activity_effective from anon;
grant select on public.daily_activity_effective to authenticated;

-- ─────────────── Stappen van vrienden en groepsgenoten (ranglijst) ───────────────
-- Alleen stappen en bron per dag (geen kcal, tijdzone of apps). Je eigen dagen krijg je altijd terug.
-- Van een ander alleen als jij deelt, die ander deelt, en jullie vrienden zijn of een groep delen.
-- Hooguit 31 dagen per keer.
create or replace function public.activity_steps_for(p_user_ids uuid[], p_from date, p_to date)
returns table (user_id uuid, date date, source text, steps int)
language plpgsql stable security definer set search_path = public as $$
declare
  me uuid := auth.uid();
  i_share boolean;
begin
  if me is null then raise exception 'Niet ingelogd'; end if;
  if p_from is null or p_to is null or p_to < p_from or p_to - p_from > 31 then
    raise exception 'Kies een periode van hooguit 31 dagen';
  end if;
  if coalesce(cardinality(p_user_ids), 0) > 500 then raise exception 'Te veel personen'; end if;
  select coalesce(s.share_activity and s.health_consent_at is not null, false) into i_share
    from activity_settings s where s.user_id = me;
  i_share := coalesce(i_share, false);

  return query
  select distinct on (d.user_id, d.date) d.user_id, d.date, d.source, d.steps
  from daily_activity d
  where d.user_id = any (p_user_ids)
    and d.date between p_from and p_to
    and d.steps is not null and not (d.source = 'healthkit' and d.steps = 0)
    and (d.user_id = me
         or (i_share
             and exists (select 1 from activity_settings o
                         where o.user_id = d.user_id and o.share_activity and o.health_consent_at is not null)
             and (public.is_friend(d.user_id) or public.shares_group(d.user_id))))
  order by d.user_id, d.date,
    case d.source when 'health_connect' then 1 when 'healthkit' then 1 when 'garmin' then 2
                  when 'shortcut' then 3 else 9 end,
    d.synced_at desc;
end;
$$;
revoke all on function public.activity_steps_for(uuid[], date, date) from public, anon;
grant execute on function public.activity_steps_for(uuid[], date, date) to authenticated;

-- ─────────────── Dagtotalen opslaan (web: handmatig; later ook de Android- en iOS-app) ───────────────
-- p_days: [{ "date": "YYYY-MM-DD", "steps": 8123, "active_kcal": 412, "total_kcal": null,
--            "source_apps": ["com.garmin.android.apps.connectmobile"] }, ...]
-- Elke aanroep VERVANGT de waarden van die dag voor die bron (nooit optellen), dus opnieuw sturen is veilig.
-- Alle velden worden vervangen, ook met null. Alle drie de waarden leeg: bij 'manual' wordt die dag gewist,
-- bij andere bronnen overgeslagen. Handmatig: hooguit 7 dagen terug. Geeft het aantal opgeslagen dagen terug.
create or replace function public.upsert_daily_activity(p_source text, p_days jsonb, p_tz text default null)
returns integer language plpgsql security definer set search_path = public as $$
declare
  me uuid := auth.uid();
  v_tz text := 'Europe/Amsterdam';
  v_tz_ok boolean := false;
  v_today date; v_min date; v_max date;
  e jsonb; v_date date;
  n_steps numeric; n_active numeric; n_total numeric;
  v_steps int; v_active int; v_total int; v_apps text[];
  n int := 0;
begin
  if me is null then raise exception 'Niet ingelogd'; end if;
  if p_source is null or p_source not in ('manual', 'health_connect', 'healthkit', 'garmin', 'shortcut') then
    raise exception 'Onbekende bron';
  end if;
  -- Zolang de Android- en iOS-app er nog niet zijn, kan alleen handmatige invoer. Anders kan iedereen
  -- via de browser zelf getypte getallen als "Health Connect" opslaan (en 400 dagen terug invullen).
  -- Voor de native apps komt er een aparte, afgeschermde route voor toestelbronnen.
  if p_source <> 'manual' then
    raise exception 'Deze bron is nog niet beschikbaar';
  end if;
  -- Toestemming controleren en vasthouden tot het einde van deze transactie (for share). Intrekken
  -- (save_activity_settings, for update) wacht hierop, of deze aanroep wacht op het intrekken en ziet
  -- daarna dat er geen toestemming meer is. Zo blijft er na intrekken nooit iets achter.
  perform 1 from activity_settings where user_id = me and health_consent_at is not null for share;
  if not found then
    raise exception 'Geen toestemming om activiteit op te slaan';
  end if;
  if p_days is null or jsonb_typeof(p_days) <> 'array' or jsonb_array_length(p_days) not between 1 and 62 then
    raise exception 'Stuur 1 tot 62 dagen';
  end if;
  if p_tz is not null and length(p_tz) <= 64 and exists (select 1 from pg_timezone_names where name = p_tz) then
    v_tz := p_tz;
    v_tz_ok := true;
  end if;
  v_today := (now() at time zone v_tz)::date;
  v_max := v_today + 1;                                            -- marge voor tijdzones
  v_min := v_today - case when p_source = 'manual' then 7 else 400 end;

  for e in select value from jsonb_array_elements(p_days) loop
    if jsonb_typeof(e) <> 'object' then raise exception 'Ongeldige invoer'; end if;
    if coalesce(e->>'date', '') !~ '^\d{4}-\d{2}-\d{2}$' then raise exception 'Ongeldige datum'; end if;
    begin
      v_date := (e->>'date')::date;
    exception when others then
      raise exception 'Ongeldige datum';
    end;
    if v_date not between v_min and v_max then
      if p_source = 'manual' then
        raise exception 'Je kunt alleen de afgelopen 7 dagen handmatig invullen';
      end if;
      raise exception 'Datum % valt buiten het toegestane bereik', v_date;
    end if;

    -- Getal of null; al het andere is een fout.
    if e ? 'steps' and jsonb_typeof(e->'steps') not in ('number', 'null') then raise exception 'Ongeldige waarde voor stappen'; end if;
    if e ? 'active_kcal' and jsonb_typeof(e->'active_kcal') not in ('number', 'null') then raise exception 'Ongeldige waarde voor actieve kcal'; end if;
    if e ? 'total_kcal' and jsonb_typeof(e->'total_kcal') not in ('number', 'null') then raise exception 'Ongeldige waarde voor totale kcal'; end if;
    n_steps  := round((e->>'steps')::numeric);
    n_active := round((e->>'active_kcal')::numeric);
    n_total  := round((e->>'total_kcal')::numeric);
    -- Eerst het bereik controleren (als numeric), dan pas naar int: geen overloopfout bij gekke getallen.
    if n_steps  is not null and n_steps  not between 0 and 100000 then raise exception 'Stappen moeten tussen 0 en 100.000 liggen'; end if;
    if n_active is not null and n_active not between 0 and 10000  then raise exception 'Actieve kcal moeten tussen 0 en 10.000 liggen'; end if;
    if n_total  is not null and n_total  not between 0 and 15000  then raise exception 'Totale kcal moeten tussen 0 en 15.000 liggen'; end if;
    v_steps := n_steps::int; v_active := n_active::int; v_total := n_total::int;

    select coalesce(array_agg(left(x, 100)), '{}') into v_apps
      from (select jsonb_array_elements_text(case when jsonb_typeof(e->'source_apps') = 'array'
                                                  then e->'source_apps' else '[]'::jsonb end) x limit 10) s;

    if v_steps is null and v_active is null and v_total is null then
      if p_source = 'manual' then
        delete from daily_activity where user_id = me and date = v_date and source = 'manual';
      end if;
      continue;
    end if;

    insert into daily_activity (user_id, date, source, steps, active_kcal, total_kcal, source_apps, tz, synced_at)
    values (me, v_date, p_source, v_steps, v_active, v_total, v_apps, case when v_tz_ok then p_tz end, now())
    on conflict (user_id, date, source) do update
      set steps = excluded.steps, active_kcal = excluded.active_kcal, total_kcal = excluded.total_kcal,
          source_apps = excluded.source_apps, tz = excluded.tz, synced_at = now();
    n := n + 1;
  end loop;
  return n;
end;
$$;
revoke all on function public.upsert_daily_activity(text, jsonb, text) from public, anon;
grant execute on function public.upsert_daily_activity(text, jsonb, text) to authenticated;

-- ─────────────── Instellingen en toestemmingen wijzigen ───────────────
-- Een parameter die null is, blijft ongewijzigd. Geeft de bijgewerkte rij terug.
-- p_store = false trekt de toestemming in: alle activiteit wordt direct verwijderd en delen,
-- coach en calorieën terugverdienen gaan uit.
create or replace function public.save_activity_settings(
  p_store boolean default null, p_share boolean default null, p_coach boolean default null,
  p_step_goal int default null, p_burn_credit_pct int default null)
returns public.activity_settings language plpgsql security definer set search_path = public as $$
declare
  me uuid := auth.uid();
  v_version constant text := 'activiteit-v1-2026-11';
  s activity_settings;
  v_birth date;
begin
  if me is null then raise exception 'Niet ingelogd'; end if;

  -- Bereik eerst controleren, zodat een fout niets half wijzigt.
  if p_step_goal is not null and p_step_goal not between 1000 and 50000 then
    raise exception 'Je stappendoel moet tussen 1.000 en 50.000 liggen';
  end if;
  if p_burn_credit_pct is not null and p_burn_credit_pct not in (0, 25, 50, 75, 100) then
    raise exception 'Kies 0, 25, 50, 75 of 100 procent';
  end if;

  insert into activity_settings (user_id) values (me) on conflict do nothing;
  select * into s from activity_settings where user_id = me for update;

  -- Toestemming geven, of opnieuw geven voor een nieuwe versie van de tekst (16+; leeftijd alleen
  -- bekend als er een geboortedatum is ingevuld). Opnieuw geven wist niets.
  if p_store is true and (s.health_consent_at is null or s.consent_version is distinct from v_version) then
    -- to_jsonb: werkt ook als de kolom birth_date (profile-extra.sql) nog ontbreekt.
    select nullif(to_jsonb(p) ->> 'birth_date', '')::date into v_birth from profiles p where p.id = me;
    if v_birth is not null and v_birth > current_date - interval '16 years' then
      raise exception 'Je moet 16 jaar of ouder zijn om activiteit bij te houden';
    end if;
    update activity_settings set health_consent_at = now(), consent_version = v_version where user_id = me;
    insert into activity_consent_log (user_id, scope, granted, version) values (me, 'store', true, v_version);
    s.health_consent_at := now();
    s.consent_version := v_version;
  end if;

  -- Toestemming intrekken: alles weg, delen en coach uit.
  if p_store is false and s.health_consent_at is not null then
    delete from daily_activity where user_id = me;
    update activity_settings
      set health_consent_at = null, share_activity = false, share_activity_at = case when s.share_activity then now() else share_activity_at end,
          coach_activity = false, coach_activity_at = case when s.coach_activity then now() else coach_activity_at end,
          burn_credit_pct = 0
      where user_id = me;
    insert into activity_consent_log (user_id, scope, granted, version) values (me, 'store', false, v_version);
    if s.share_activity then
      insert into activity_consent_log (user_id, scope, granted, version) values (me, 'share', false, v_version);
    end if;
    if s.coach_activity then
      insert into activity_consent_log (user_id, scope, granted, version) values (me, 'coach', false, v_version);
    end if;
    s.health_consent_at := null;
    s.share_activity := false;
    s.coach_activity := false;
    s.burn_credit_pct := 0;
  end if;

  if p_share is not null and p_share is distinct from s.share_activity then
    if p_share and s.health_consent_at is null then
      raise exception 'Geef eerst toestemming om activiteit op te slaan';
    end if;
    update activity_settings set share_activity = p_share, share_activity_at = now() where user_id = me;
    insert into activity_consent_log (user_id, scope, granted, version) values (me, 'share', p_share, v_version);
  end if;

  if p_coach is not null and p_coach is distinct from s.coach_activity then
    if p_coach and s.health_consent_at is null then
      raise exception 'Geef eerst toestemming om activiteit op te slaan';
    end if;
    update activity_settings set coach_activity = p_coach, coach_activity_at = now() where user_id = me;
    insert into activity_consent_log (user_id, scope, granted, version) values (me, 'coach', p_coach, v_version);
  end if;

  if p_step_goal is not null then
    update activity_settings set step_goal = p_step_goal where user_id = me;
  end if;

  if p_burn_credit_pct is not null then
    if p_burn_credit_pct > 0 and s.health_consent_at is null then
      raise exception 'Geef eerst toestemming om activiteit op te slaan';
    end if;
    update activity_settings set burn_credit_pct = p_burn_credit_pct where user_id = me;
  end if;

  update activity_settings set updated_at = now() where user_id = me returning * into s;
  return s;
end;
$$;
revoke all on function public.save_activity_settings(boolean, boolean, boolean, int, int) from public, anon;
grant execute on function public.save_activity_settings(boolean, boolean, boolean, int, int) to authenticated;
