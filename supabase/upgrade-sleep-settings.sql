-- Slaap: instellingen per gebruiker (slaapdoel en, los aan te zetten, slaap gebruiken door de AI-coach).
-- Plak dit in Supabase → SQL Editor → New query → Run, NA upgrade-sleep.sql. Veilig om opnieuw te draaien.
--
-- Wat verandert er?
-- 1. activity_settings krijgt drie kolommen:
--    - sleep_goal_minutes: je slaapdoel per nacht (4 tot 12 uur, standaard 8 uur). Alleen voor weergave.
--    - coach_sleep / coach_sleep_at: mag de AI-coach je slaap lezen? Staat standaard UIT.
-- 2. Nieuwe functie save_sleep_settings: de enige schrijfroute voor deze kolommen.
-- 3. Een trigger zet coach_sleep automatisch uit zodra de toestemming voor activiteit wordt ingetrokken of
--    "Gebruiken door de AI-coach" uitgaat. Zo gaat slaap nooit naar de coach zonder beide toestemmingen.
-- 4. activity_consent_log accepteert ook scope 'coach_sleep' (elke wijziging wordt vastgelegd).
-- Gaat coach_sleep uit, dan schermt de trigger activity_settings_withdraw_cleanup (upgrade-sleep.sql) de
-- slaap in oude coachgesprekken af; de coach-API slaat uitkomsten van get_sleep sowieso niet op.
--
-- Privacy (gezondheidsgegevens, AVG art. 9):
-- - Slaap naar de AI-coach (Anthropic, als verwerker) is een aparte, uitdrukkelijke keuze bovenop
--   "Gebruiken door de AI-coach" (die alleen over stappen en kcal ging), standaard uit. Aanzetten kan pas met toestemming voor tekstversie v2
--   of later (de tekst die slaap noemt) en met de coach-toestemming voor activiteit aan.
-- - Slaap wordt nog steeds NIET gedeeld met vrienden, groepen of trainers. Er is geen functie om andermans
--   slaap te lezen.
-- - Draai je upgrade-activity.sql of upgrade-sleep.sql opnieuw, dan blijven deze kolommen en de trigger
--   gewoon staan; dit script hoeft dan niet opnieuw (mag wel).

-- ─────────────── Kolommen ───────────────
alter table public.activity_settings add column if not exists sleep_goal_minutes int not null default 480;
alter table public.activity_settings add column if not exists coach_sleep boolean not null default false;
alter table public.activity_settings add column if not exists coach_sleep_at timestamptz;

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'activity_settings_sleep_goal_range') then
    alter table public.activity_settings
      add constraint activity_settings_sleep_goal_range check (sleep_goal_minutes between 240 and 720);
  end if;
end $$;

-- ─────────────── Toestemmingslog: ook 'coach_sleep' ───────────────
alter table public.activity_consent_log drop constraint if exists activity_consent_log_scope_check;
alter table public.activity_consent_log
  add constraint activity_consent_log_scope_check check (scope in ('store', 'share', 'coach', 'coach_sleep'));

-- ─────────────── Slaap naar de coach: automatisch uit zonder beide toestemmingen ───────────────
-- save_activity_settings (intrekken, coach uitzetten) hoeft hiervoor niet te veranderen.
create or replace function public.activity_settings_coach_sleep_guard()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if new.coach_sleep and (new.health_consent_at is null or not new.coach_activity) then
    new.coach_sleep := false;
    new.coach_sleep_at := now();
    insert into activity_consent_log (user_id, scope, granted, version)
      values (new.user_id, 'coach_sleep', false, coalesce(new.consent_version, 'onbekend'));
  end if;
  return new;
end;
$$;
revoke all on function public.activity_settings_coach_sleep_guard() from public, anon, authenticated;

drop trigger if exists activity_settings_coach_sleep_guard on public.activity_settings;
create trigger activity_settings_coach_sleep_guard
  before update on public.activity_settings
  for each row execute function public.activity_settings_coach_sleep_guard();

-- ─────────────── Opslaan ───────────────
-- Alleen meegegeven waarden worden gewijzigd. Geeft de hele rij terug (zoals save_activity_settings).
create or replace function public.save_sleep_settings(p_goal_minutes int default null, p_coach_sleep boolean default null)
returns public.activity_settings language plpgsql security definer set search_path = public as $$
declare
  me uuid := auth.uid();
  s activity_settings;
begin
  if me is null then raise exception 'Niet ingelogd'; end if;
  if p_goal_minutes is not null and p_goal_minutes not between 240 and 720 then
    raise exception 'Je slaapdoel moet tussen 4 en 12 uur liggen';
  end if;

  insert into activity_settings (user_id) values (me) on conflict do nothing;
  select * into s from activity_settings where user_id = me for update;

  if p_goal_minutes is not null then
    update activity_settings set sleep_goal_minutes = p_goal_minutes where user_id = me;
  end if;

  if p_coach_sleep is not null and p_coach_sleep is distinct from s.coach_sleep then
    if p_coach_sleep then
      if s.health_consent_at is null then
        raise exception 'Geef eerst toestemming om activiteit op te slaan';
      end if;
      -- v1 was de tekst van vóór slaap (zelfde regel als upsert_daily_sleep).
      if s.consent_version is null or s.consent_version = 'activiteit-v1-2026-11' then
        raise exception 'Geef opnieuw toestemming om ook je slaap op te slaan';
      end if;
      if not s.coach_activity then
        raise exception 'Zet eerst Gebruiken door de AI-coach aan';
      end if;
    end if;
    update activity_settings set coach_sleep = p_coach_sleep, coach_sleep_at = now() where user_id = me;
    insert into activity_consent_log (user_id, scope, granted, version)
      values (me, 'coach_sleep', p_coach_sleep, coalesce(s.consent_version, 'onbekend'));
  end if;

  update activity_settings set updated_at = now() where user_id = me returning * into s;
  return s;
end;
$$;
revoke all on function public.save_sleep_settings(int, boolean) from public, anon;
grant execute on function public.save_sleep_settings(int, boolean) to authenticated;

notify pgrst, 'reload schema';
