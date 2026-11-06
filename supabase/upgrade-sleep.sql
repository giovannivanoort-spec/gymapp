-- Slaap: per nacht hoe lang je sliep (handmatig, Health Connect op Android, later Apple Health op iPhone).
-- Plak dit in Supabase → SQL Editor → New query → Run, NA upgrade-activity.sql en upgrade-activity-native.sql
-- (en na coach.sql). Daarna upgrade-sleep-settings.sql. Veilig om opnieuw te draaien.
--
-- Volgorde bij het uitrollen maakt niet uit: de site stuurt zelf mee welke versie van de toestemmingstekst
-- hij heeft getoond (give_activity_consent). De oude site (zonder die functie) slaat via
-- save_activity_settings altijd versie v1 op: dat is de tekst die hij toont, en v1 geeft geen toegang tot slaap.
-- Draai je upgrade-activity.sql later nog eens, draai dan daarna upgrade-activity-native.sql en dit script
-- opnieuw. Ook zonder dat blijft intrekken alle activiteit en slaap wissen (trigger, punt 6).
--
-- Wat verandert er?
-- 1. Nieuwe tabel daily_sleep: één rij per gebruiker × datum × bron. De datum is de LOKALE datum waarop je
--    wakker werd (de nacht van zondag op maandag hoort bij maandag).
-- 2. View daily_sleep_effective: één nacht per dag; een telefoon of horloge gaat voor handmatig (nooit optellen).
-- 3. Functie upsert_daily_sleep: de enige schrijfroute (zelfde opzet als upsert_daily_activity).
-- 4. Nieuwe functie give_activity_consent(p_version): toestemming geven voor de tekstversie die de app
--    echt heeft getoond ('activiteit-v1-2026-11' zonder slaap, 'activiteit-v2-2026-11' met slaap).
-- 5. save_activity_settings opnieuw: intrekken verwijdert ook alle slaap; p_store = true (alleen nog door
--    de oude site gebruikt) slaat versie v1 op, de tekst die die site toont.
-- 6. Trigger op activity_settings, los van de functies hierboven: toestemming ingetrokken → alle activiteit
--    en slaap weg, en uitkomsten van get_activity/get_sleep in coachgesprekken afgeschermd; coach-toestemming
--    (activiteit of slaap) uit → die uitkomsten ook afgeschermd. Zo hangt het wissen niet af van welke versie
--    van save_activity_settings er toevallig staat.
--
-- Privacy (gezondheidsgegevens, AVG art. 9):
-- - Slaap valt onder dezelfde toestemming als activiteit (activity_settings.health_consent_at), maar de
--   inhoud van die toestemming is uitgebreid. Daarom is er een nieuwe tekstversie: wie toestemming gaf voor
--   v1 (alleen stappen en kcal) moet eerst opnieuw toestemming geven. Tot die tijd weigert upsert_daily_sleep
--   elke slaap (stappen blijven gewoon werken).
-- - Slaap wordt NIET gedeeld met vrienden, groepen of trainers. Er is geen functie om andermans slaap te
--   lezen; de tabel en de view tonen alleen je eigen rijen.
-- - De AI-coach (Anthropic, als verwerker) leest slaap alleen met een aparte keuze die standaard uit staat
--   (coach_sleep, upgrade-sleep-settings.sql). De uitkomst wordt niet in het gesprek bewaard.
-- - Toestemming intrekken verwijdert direct alle slaap (en activiteit). Je kunt ook alleen je slaap of al
--   je gegevens verwijderen en de toestemming laten staan (delete op daily_sleep, alleen je eigen rijen).
-- - Account verwijderen ruimt alles op via "on delete cascade" op profiles.
--
-- Versies van de toestemmingstekst: zie give_activity_consent. Een nieuwe versie: toevoegen aan de lijst
-- daar, samen met ACTIVITY_CONSENT_VERSION in src/lib/activity.ts. upsert_daily_sleep accepteert elke
-- versie behalve v1 (de versie van vóór slaap), dus die hoeft dan niet te veranderen.

-- ─────────────── Slaap per nacht: één rij per gebruiker × wakkerworddatum × bron ───────────────
create table if not exists public.daily_sleep (
  user_id uuid not null references public.profiles (id) on delete cascade,
  date date not null,                            -- LOKALE datum van wakker worden (geen UTC)
  source text not null check (source in ('manual', 'health_connect', 'healthkit')),
  asleep_minutes int not null check (asleep_minutes between 0 and 1080),       -- echt geslapen, zonder wakker/in bed
  in_bed_minutes int check (in_bed_minutes between 0 and 1440),                -- van gaan slapen tot opstaan
  bedtime timestamptz,                           -- begin van de nacht
  wake_time timestamptz,                         -- einde van de nacht
  deep_minutes int check (deep_minutes between 0 and 1080),                    -- fases: null = niet gemeten
  light_minutes int check (light_minutes between 0 and 1080),
  rem_minutes int check (rem_minutes between 0 and 1080),
  awake_minutes int check (awake_minutes between 0 and 720),
  source_apps text[] not null default '{}' check (cardinality(source_apps) <= 10),  -- bv. {com.sec.android.app.shealth}
  tz text check (tz is null or length(tz) <= 64),                              -- IANA-tijdzone van het toestel (ter info)
  synced_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  primary key (user_id, date, source),
  constraint daily_sleep_times check (
    bedtime is null or wake_time is null
    or (wake_time > bedtime and wake_time - bedtime <= interval '24 hours'))
);
create index if not exists daily_sleep_date on public.daily_sleep (date, user_id);

alter table public.daily_sleep enable row level security;
-- Lezen en verwijderen: alleen je eigen nachten. Niemand anders leest slaap (ook geen vrienden).
drop policy if exists "sleep read own" on public.daily_sleep;
create policy "sleep read own" on public.daily_sleep for select to authenticated
  using (user_id = auth.uid());
drop policy if exists "sleep delete own" on public.daily_sleep;
create policy "sleep delete own" on public.daily_sleep for delete to authenticated
  using (user_id = auth.uid());
-- Toevoegen en wijzigen alleen via upsert_daily_sleep.
revoke insert, update, truncate on public.daily_sleep from authenticated, anon;
revoke all on public.daily_sleep from anon;
grant select, delete on public.daily_sleep to authenticated;

-- ─────────────── Eén nacht per dag: bronnen worden NOOIT opgeteld ───────────────
-- Voorrang: telefoon/horloge via Health Connect of Apple Health > handmatig; daarna de nieuwste.
-- security_invoker: de leesregel van daily_sleep geldt ook hier (dus alleen je eigen nachten).
create or replace view public.daily_sleep_effective with (security_invoker = true) as
select distinct on (user_id, date)
  user_id, date, source, asleep_minutes, in_bed_minutes, bedtime, wake_time,
  deep_minutes, light_minutes, rem_minutes, awake_minutes, source_apps, synced_at
from public.daily_sleep
order by user_id, date,
  case source when 'health_connect' then 1 when 'healthkit' then 1 else 9 end,
  synced_at desc;
revoke all on public.daily_sleep_effective from anon;
grant select on public.daily_sleep_effective to authenticated;

-- ─────────────── Slaap opslaan (web: handmatig; Android: health_connect; iOS later: healthkit) ───────────────
-- p_days: [{ "date": "YYYY-MM-DD",                 -- lokale datum van wakker worden
--            "asleep_minutes": 444, "in_bed_minutes": 478,
--            "bedtime": "2026-11-05T22:41:00Z", "wake_time": "2026-11-06T06:39:00Z",
--            "deep_minutes": 62, "light_minutes": 270, "rem_minutes": 112, "awake_minutes": 34,
--            "source_apps": ["com.sec.android.app.shealth"] }, ...]
-- Elke aanroep VERVANGT de nacht van die dag voor die bron (nooit optellen), dus opnieuw sturen is veilig.
-- Alle velden worden vervangen, ook met null. asleep_minutes leeg: bij 'manual' wordt die dag gewist, bij
-- andere bronnen overgeslagen. Handmatig: hooguit 7 dagen terug; Health Connect en Apple Health: hooguit
-- 30 dagen terug. Zelfde opzet en controles als upsert_daily_activity. Geeft het aantal opgeslagen nachten terug.
-- Zie upgrade-activity-native.sql waarom toestelbronnen via deze gewone route voor een vriendenapp acceptabel zijn.
create or replace function public.upsert_daily_sleep(p_source text, p_days jsonb, p_tz text default null)
returns integer language plpgsql security definer set search_path = public as $$
declare
  me uuid := auth.uid();
  v_tz text := 'Europe/Amsterdam';
  v_tz_ok boolean := false;
  v_today date; v_min date; v_max date;
  e jsonb; v_date date;
  n_asleep numeric; n_bed numeric; n_deep numeric; n_light numeric; n_rem numeric; n_awake numeric;
  v_bedtime timestamptz; v_wake timestamptz;
  v_apps text[];
  k text;
  n int := 0;
begin
  if me is null then raise exception 'Niet ingelogd'; end if;
  if p_source is null or p_source not in ('manual', 'health_connect', 'healthkit') then
    raise exception 'Onbekende bron';
  end if;
  -- Toestemming controleren en vasthouden tot het einde van deze transactie (for share), net als bij
  -- upsert_daily_activity: intrekken wacht hierop, of deze aanroep ziet daarna dat er geen toestemming meer is.
  -- Toestemming voor v1 (van vóór slaap) telt niet: eerst opnieuw toestemming geven.
  perform 1 from activity_settings
    where user_id = me and health_consent_at is not null
      and consent_version is not null and consent_version <> 'activiteit-v1-2026-11'
    for share;
  if not found then
    if exists (select 1 from activity_settings where user_id = me and health_consent_at is not null) then
      raise exception 'Geef opnieuw toestemming om ook je slaap op te slaan';
    end if;
    raise exception 'Geen toestemming om slaap op te slaan';
  end if;
  if p_days is null or jsonb_typeof(p_days) <> 'array' or jsonb_array_length(p_days) not between 1 and 62 then
    raise exception 'Stuur 1 tot 62 nachten';
  end if;
  if p_tz is not null and length(p_tz) <= 64 and exists (select 1 from pg_timezone_names where name = p_tz) then
    v_tz := p_tz;
    v_tz_ok := true;
  end if;
  v_today := (now() at time zone v_tz)::date;
  v_max := v_today + 1;                                                     -- marge voor tijdzones
  v_min := v_today - case when p_source = 'manual' then 7 else 30 end;      -- toestelbronnen: hooguit 30 dagen terug

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
        raise exception 'Je kunt alleen de afgelopen 7 nachten handmatig invullen';
      end if;
      raise exception 'Datum % valt buiten het toegestane bereik', v_date;
    end if;

    -- Getal of null; al het andere is een fout.
    foreach k in array array['asleep_minutes', 'in_bed_minutes', 'deep_minutes', 'light_minutes', 'rem_minutes', 'awake_minutes'] loop
      if e ? k and jsonb_typeof(e->k) not in ('number', 'null') then raise exception 'Ongeldige waarde voor slaap'; end if;
    end loop;
    n_asleep := round((e->>'asleep_minutes')::numeric);
    n_bed    := round((e->>'in_bed_minutes')::numeric);
    n_deep   := round((e->>'deep_minutes')::numeric);
    n_light  := round((e->>'light_minutes')::numeric);
    n_rem    := round((e->>'rem_minutes')::numeric);
    n_awake  := round((e->>'awake_minutes')::numeric);
    -- Eerst het bereik controleren (als numeric), dan pas naar int: geen overloopfout bij gekke getallen.
    if n_asleep is not null and n_asleep not between 0 and 1080 then raise exception 'Slaap moet tussen 0 en 18 uur liggen'; end if;
    if n_bed    is not null and n_bed    not between 0 and 1440 then raise exception 'Tijd in bed moet tussen 0 en 24 uur liggen'; end if;
    if n_deep   is not null and n_deep   not between 0 and 1080 then raise exception 'Ongeldige waarde voor diepe slaap'; end if;
    if n_light  is not null and n_light  not between 0 and 1080 then raise exception 'Ongeldige waarde voor lichte slaap'; end if;
    if n_rem    is not null and n_rem    not between 0 and 1080 then raise exception 'Ongeldige waarde voor REM-slaap'; end if;
    if n_awake  is not null and n_awake  not between 0 and 720  then raise exception 'Ongeldige waarde voor wakker'; end if;
    if n_asleep is not null and n_bed is not null and n_bed < n_asleep then
      raise exception 'Tijd in bed kan niet korter zijn dan je slaap';
    end if;

    -- Tijden: ISO-tekst of null.
    if e ? 'bedtime' and jsonb_typeof(e->'bedtime') not in ('string', 'null') then raise exception 'Ongeldige bedtijd'; end if;
    if e ? 'wake_time' and jsonb_typeof(e->'wake_time') not in ('string', 'null') then raise exception 'Ongeldige wektijd'; end if;
    begin
      v_bedtime := nullif(e->>'bedtime', '')::timestamptz;
      v_wake := nullif(e->>'wake_time', '')::timestamptz;
    exception when others then
      raise exception 'Ongeldige tijd';
    end;
    if v_bedtime is not null and v_wake is not null
       and (v_wake <= v_bedtime or v_wake - v_bedtime > interval '24 hours') then
      raise exception 'Je wektijd moet na je bedtijd liggen, hooguit 24 uur later';
    end if;
    -- De nacht hoort bij de dag van wakker worden (marge van een dag voor tijdzones en reizen).
    if v_wake is not null and (v_wake at time zone v_tz)::date not between v_date - 1 and v_date + 1 then
      raise exception 'Je wektijd past niet bij de gekozen datum';
    end if;

    select coalesce(array_agg(left(x, 100)), '{}') into v_apps
      from (select jsonb_array_elements_text(case when jsonb_typeof(e->'source_apps') = 'array'
                                                  then e->'source_apps' else '[]'::jsonb end) x limit 10) s;

    if n_asleep is null then
      if p_source = 'manual' then
        delete from daily_sleep where user_id = me and date = v_date and source = 'manual';
      end if;
      continue;
    end if;

    insert into daily_sleep (user_id, date, source, asleep_minutes, in_bed_minutes, bedtime, wake_time,
                             deep_minutes, light_minutes, rem_minutes, awake_minutes, source_apps, tz, synced_at)
    values (me, v_date, p_source, n_asleep::int, n_bed::int, v_bedtime, v_wake,
            n_deep::int, n_light::int, n_rem::int, n_awake::int, v_apps, case when v_tz_ok then p_tz end, now())
    on conflict (user_id, date, source) do update
      set asleep_minutes = excluded.asleep_minutes, in_bed_minutes = excluded.in_bed_minutes,
          bedtime = excluded.bedtime, wake_time = excluded.wake_time,
          deep_minutes = excluded.deep_minutes, light_minutes = excluded.light_minutes,
          rem_minutes = excluded.rem_minutes, awake_minutes = excluded.awake_minutes,
          source_apps = excluded.source_apps, tz = excluded.tz, synced_at = now();
    n := n + 1;
  end loop;
  return n;
end;
$$;
revoke all on function public.upsert_daily_sleep(text, jsonb, text) from public, anon;
grant execute on function public.upsert_daily_sleep(text, jsonb, text) to authenticated;

-- ─────────────── Toestemming geven voor de getoonde tekstversie ───────────────
-- De app stuurt de versie van de tekst die hij echt heeft getoond (ACTIVITY_CONSENT_VERSION). Zo klopt het
-- bewijs van toestemming ook als de site en de database even niet gelijk lopen. Alleen bekende versies.
-- Opnieuw geven (andere versie) wist niets. Geeft de bijgewerkte rij terug.
create or replace function public.give_activity_consent(p_version text)
returns public.activity_settings language plpgsql security definer set search_path = public as $$
declare
  me uuid := auth.uid();
  s activity_settings;
  v_birth date;
begin
  if me is null then raise exception 'Niet ingelogd'; end if;
  if p_version is null or p_version not in ('activiteit-v1-2026-11', 'activiteit-v2-2026-11') then
    raise exception 'Onbekende versie van de toestemmingstekst. Herlaad de app.';
  end if;

  insert into activity_settings (user_id) values (me) on conflict do nothing;
  select * into s from activity_settings where user_id = me for update;

  if s.health_consent_at is null or s.consent_version is distinct from p_version then
    -- 16+; leeftijd alleen bekend als er een geboortedatum is ingevuld. to_jsonb: werkt ook als de
    -- kolom birth_date (profile-extra.sql) nog ontbreekt.
    select nullif(to_jsonb(p) ->> 'birth_date', '')::date into v_birth from profiles p where p.id = me;
    if v_birth is not null and v_birth > current_date - interval '16 years' then
      raise exception 'Je moet 16 jaar of ouder zijn om activiteit bij te houden';
    end if;
    update activity_settings set health_consent_at = now(), consent_version = p_version where user_id = me;
    insert into activity_consent_log (user_id, scope, granted, version) values (me, 'store', true, p_version);
  end if;

  update activity_settings set updated_at = now() where user_id = me returning * into s;
  return s;
end;
$$;
revoke all on function public.give_activity_consent(text) from public, anon;
grant execute on function public.give_activity_consent(text) to authenticated;

-- ─────────────── Instellingen en toestemmingen wijzigen ───────────────
-- Gelijk aan de versie in upgrade-activity.sql, met twee verschillen:
-- - Intrekken (p_store = false) verwijdert ook alle slaap (de trigger hieronder doet dat ook, als vangnet).
-- - Logregels krijgen de versie waarvoor de gebruiker toestemming gaf (consent_version).
-- p_store = true is er nog voor de oude site (die give_activity_consent niet kent) en slaat daarom altijd
-- versie v1 op: de tekst die die site toont, zonder slaap. De nieuwe site geeft toestemming via
-- give_activity_consent.
-- Een parameter die null is, blijft ongewijzigd. Geeft de bijgewerkte rij terug.
create or replace function public.save_activity_settings(
  p_store boolean default null, p_share boolean default null, p_coach boolean default null,
  p_step_goal int default null, p_burn_credit_pct int default null)
returns public.activity_settings language plpgsql security definer set search_path = public as $$
declare
  me uuid := auth.uid();
  v_legacy_version constant text := 'activiteit-v1-2026-11';
  v_version text;
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
  v_version := coalesce(s.consent_version, v_legacy_version);

  -- Toestemming geven via de oude site: tekst v1 (16+; leeftijd alleen bekend als er een geboortedatum
  -- is ingevuld). Opnieuw geven wist niets.
  if p_store is true and (s.health_consent_at is null or s.consent_version is distinct from v_legacy_version) then
    select nullif(to_jsonb(p) ->> 'birth_date', '')::date into v_birth from profiles p where p.id = me;
    if v_birth is not null and v_birth > current_date - interval '16 years' then
      raise exception 'Je moet 16 jaar of ouder zijn om activiteit bij te houden';
    end if;
    update activity_settings set health_consent_at = now(), consent_version = v_legacy_version where user_id = me;
    insert into activity_consent_log (user_id, scope, granted, version) values (me, 'store', true, v_legacy_version);
    s.health_consent_at := now();
    s.consent_version := v_legacy_version;
    v_version := v_legacy_version;
  end if;

  -- Toestemming intrekken: alles weg (activiteit en slaap), delen en coach uit.
  if p_store is false and s.health_consent_at is not null then
    delete from daily_activity where user_id = me;
    delete from daily_sleep where user_id = me;
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

-- ─────────────── Gezondheidsuitkomsten in coachgesprekken afschermen ───────────────
-- De coach-API (src/app/api/coach/route.ts) slaat uitkomsten van get_activity en get_sleep niet meer op.
-- Deze functie schermt rijen van daarvoor af: in elk tool-resultaat van p_user waarvan de tool_use (in het
-- assistent-bericht ervoor, zelfde id) een van p_tools is, wordt de inhoud vervangen door dezelfde melding
-- als in route.ts (HEALTH_REDACTED). Foutmeldingen bevatten geen gegevens en blijven staan.
-- Alleen voor de trigger hieronder; niet aan te roepen door gebruikers.
create or replace function public.redact_health_tool_results(p_user uuid, p_tools text[])
returns void language plpgsql security definer set search_path = public as $$
declare
  v_note constant jsonb := to_jsonb('Gegevens niet bewaard: gezondheidsgegevens worden alleen gebruikt in het antwoord waarin ze zijn opgehaald. Roep de tool opnieuw aan als je ze weer nodig hebt.'::text);
  v_ids text[];
begin
  if p_user is null or to_regclass('public.coach_messages') is null then return; end if;

  select coalesce(array_agg(b ->> 'id'), '{}') into v_ids
    from coach_messages m
    join coach_conversations c on c.id = m.conversation_id
    cross join lateral jsonb_array_elements(case when jsonb_typeof(m.content) = 'array' then m.content else '[]'::jsonb end) b
    where c.user_id = p_user and m.kind = 'assistant'
      and b ->> 'type' = 'tool_use' and b ->> 'name' = any (p_tools) and b ? 'id';
  if cardinality(v_ids) = 0 then return; end if;

  update coach_messages m
    set content = (
      select jsonb_agg(
               case when b ->> 'type' = 'tool_result' and b ->> 'tool_use_id' = any (v_ids)
                         and coalesce(b ->> 'is_error', 'false') <> 'true'
                    then jsonb_set(b, '{content}', v_note) else b end
               order by ord)
        from jsonb_array_elements(m.content) with ordinality t(b, ord))
    from coach_conversations c
    where c.id = m.conversation_id and c.user_id = p_user and m.kind = 'tool_results'
      and jsonb_typeof(m.content) = 'array'
      and exists (select 1 from jsonb_array_elements(m.content) x
                   where x ->> 'tool_use_id' = any (v_ids)
                     and coalesce(x ->> 'is_error', 'false') <> 'true'
                     and x -> 'content' is distinct from v_note);
end;
$$;
revoke all on function public.redact_health_tool_results(uuid, text[]) from public, anon, authenticated;

-- ─────────────── Vangnet: wissen bij intrekken, los van save_activity_settings ───────────────
-- Draait na elke wijziging van activity_settings, welke versie van save_activity_settings er ook staat
-- (ook als upgrade-activity.sql opnieuw is gedraaid en de functie weer v1 is, zonder slaap):
-- - toestemming ingetrokken (health_consent_at van gevuld naar leeg): alle activiteit en slaap weg en
--   gezondheidsuitkomsten in coachgesprekken afgeschermd;
-- - "Gebruiken door de AI-coach" uit: uitkomsten van get_activity en get_sleep afgeschermd;
-- - slaap voor de coach uit (coach_sleep, upgrade-sleep-settings.sql): uitkomsten van get_sleep afgeschermd.
-- coach_sleep via to_jsonb: werkt ook als upgrade-sleep-settings.sql nog niet is gedraaid.
-- Let op: houd save_activity_settings op de versie hierboven (draai dit script na upgrade-activity.sql).
create or replace function public.activity_settings_withdraw_cleanup()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  v_old jsonb;
  v_new jsonb;
begin
  v_old := to_jsonb(old);
  v_new := to_jsonb(new);
  if old.health_consent_at is not null and new.health_consent_at is null then
    delete from daily_sleep where user_id = new.user_id;
    delete from daily_activity where user_id = new.user_id;
    perform redact_health_tool_results(new.user_id, array['get_activity', 'get_sleep']);
  elsif coalesce((v_old ->> 'coach_activity')::boolean, false) and not coalesce((v_new ->> 'coach_activity')::boolean, false) then
    perform redact_health_tool_results(new.user_id, array['get_activity', 'get_sleep']);
  elsif coalesce((v_old ->> 'coach_sleep')::boolean, false) and not coalesce((v_new ->> 'coach_sleep')::boolean, false) then
    perform redact_health_tool_results(new.user_id, array['get_sleep']);
  end if;
  return null;
end;
$$;
revoke all on function public.activity_settings_withdraw_cleanup() from public, anon, authenticated;

drop trigger if exists activity_settings_withdraw_cleanup on public.activity_settings;
create trigger activity_settings_withdraw_cleanup
  after update on public.activity_settings
  for each row execute function public.activity_settings_withdraw_cleanup();

-- Eenmalig (en onschadelijk bij opnieuw draaien): oude gesprekken van wie nu geen (coach-)toestemming
-- heeft, alsnog afschermen.
do $$
declare r record;
begin
  if to_regclass('public.coach_messages') is null then return; end if;
  for r in select a.user_id, to_jsonb(a) as j from public.activity_settings a loop
    if (r.j ->> 'health_consent_at') is null or not coalesce((r.j ->> 'coach_activity')::boolean, false) then
      perform public.redact_health_tool_results(r.user_id, array['get_activity', 'get_sleep']);
    elsif not coalesce((r.j ->> 'coach_sleep')::boolean, false) then
      perform public.redact_health_tool_results(r.user_id, array['get_sleep']);
    end if;
  end loop;
end $$;

-- Controle: staat save_activity_settings op de versie van dit script? Na het opnieuw draaien van
-- upgrade-activity.sql niet meer; het wissen werkt dan nog via de trigger, maar draai dit script opnieuw.
do $$
begin
  if not exists (select 1 from pg_proc where proname = 'save_activity_settings'
                   and pronamespace = 'public'::regnamespace and prosrc like '%delete from daily_sleep%') then
    raise notice 'save_activity_settings is niet de versie uit upgrade-sleep.sql. Draai upgrade-sleep.sql opnieuw.';
  end if;
end $$;

notify pgrst, 'reload schema';
