-- Activiteit vanuit de Android-app (Health Connect) en later de iOS-app (Apple Health).
-- Plak dit in Supabase → SQL Editor → New query → Run, NA upgrade-activity.sql. Veilig om opnieuw te draaien.
-- Let op: draai je upgrade-activity.sql later nog eens, draai dit script daarna ook opnieuw (anders
-- weigert de server Health Connect weer).
--
-- Wat verandert er?
-- Alleen de functie upsert_daily_activity (zelfde naam, parameters en rechten). Die accepteerde tot nu
-- toe alleen de bron 'manual'. Nu ook 'health_connect' (Android) en 'healthkit' (iPhone, later), van
-- ingelogde gebruikers. Toestelbronnen mogen hooguit 30 dagen terug (was 400 in de opzet; handmatig
-- blijft 7). Al het andere is ongewijzigd: inloggen verplicht, toestemming (health_consent_at) vereist
-- en vastgehouden tot het einde van de transactie, 1 tot 62 dagen per aanroep, datums als YYYY-MM-DD,
-- alleen getallen, grenzen (stappen 0..100.000, actieve kcal 0..10.000, totale kcal 0..15.000),
-- hooguit 10 app-namen van 100 tekens, en vervangen in plaats van optellen.
--
-- Waarom is dit acceptabel (zie docs/health-koppeling.md, 3.2 stap 3)?
-- De app praat met dezelfde RPC als de website, met de gewone inlogsessie. De server kan dus niet
-- bewijzen dat getallen echt uit Health Connect komen: iemand met technische kennis kan via de browser
-- zelf getallen als "Health Connect" opslaan. Voor Spotter is dat aanvaardbaar:
-- - Het is een app voor een vriendengroep; er staat niets op het spel (geen prijzen, geen geld).
-- - De bron is alleen een label en een voorrangsregel in daily_activity_effective. Het geeft geen
--   extra rechten en wordt nooit opgeteld bij andere bronnen.
-- - Alle waarden blijven begrensd (zelfde grenzen als handmatig) en hooguit 30 dagen terug.
-- - Je kunt alleen je eigen dagen wijzigen, alleen met toestemming, en vrienden zien alleen stappen
--   als jij en zij allebei delen.
-- Wordt dit ooit een openbare app met prijzen of wedstrijden, maak dan een afgeschermde route voor
-- toestelbronnen (route handler met de service-rol en een uploadtoken per toestel) en zet deze
-- bronnen hier weer uit.

-- ─────────────── Dagtotalen opslaan (web: handmatig; Android: health_connect; iOS later: healthkit) ───────────────
-- p_days: [{ "date": "YYYY-MM-DD", "steps": 8123, "active_kcal": 412, "total_kcal": null,
--            "source_apps": ["com.garmin.android.apps.connectmobile"] }, ...]
-- Elke aanroep VERVANGT de waarden van die dag voor die bron (nooit optellen), dus opnieuw sturen is veilig.
-- Alle velden worden vervangen, ook met null. Alle drie de waarden leeg: bij 'manual' wordt die dag gewist,
-- bij andere bronnen overgeslagen. Handmatig: hooguit 7 dagen terug; Health Connect en Apple Health:
-- hooguit 30 dagen terug. Geeft het aantal opgeslagen dagen terug.
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
  -- Handmatig (web) en de telefoonbronnen van de apps: Health Connect (Android) en Apple Health (iOS,
  -- later). Garmin en snelkoppeling hebben nog geen eigen route en blijven geweigerd.
  -- Zie de uitleg bovenaan upgrade-activity-native.sql waarom dit voor een vriendenapp acceptabel is.
  if p_source not in ('manual', 'health_connect', 'healthkit') then
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
