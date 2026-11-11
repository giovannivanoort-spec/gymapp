-- Eigen geschiedenis blijft zichtbaar na het verlaten van (of verwijderd worden uit) een groep.
-- Plak dit in Supabase → SQL Editor → New query → Run, NA schema.sql en friends.sql. Veilig om opnieuw
-- te draaien.
-- schema.sql en friends.sql bevatten dezelfde functies en leesregels al, dus een nieuwe installatie of
-- het opnieuw draaien van die scripts houdt dit in stand. Dit script is voor een bestaande database
-- die schema.sql en friends.sql al eerder (in de oude vorm) heeft gedraaid.
-- Draai dit script vóór het uitrollen van de bijbehorende app-versie: die belooft bij het verlaten
-- dat je eigen sets, records en ranks blijven. Zonder dit script verdwijnen ze bij de eerstvolgende
-- volledige synchronisatie (binnen 12 uur) alsnog. Na het verlaten ververst de app de geschiedenis
-- bewust alleen gedeeltelijk, zodat er zonder dit script niet meteen alles uit records en ranks valt.
--
-- Waarom?
-- Sets, oefeningen en trainingen waren alleen leesbaar via het lidmaatschap van de groep (of via een
-- vriendschap). Na het verlaten van een groep, of als een trainer je eruit haalt, verdwenen daardoor je
-- eigen sets uit die groep: uit progressie, records, ranks, de export en de AI-coach.
--
-- Wat verandert er?
-- 1. Twee nieuwe hulpfuncties: own_logged_wex en own_logged_workout. Ze zeggen alleen of de ingelogde
--    gebruiker zelf sets heeft gelogd in een oefening of training. Ze kijken uitsluitend naar rijen van
--    auth.uid() en geven geen gegevens terug, alleen waar of onwaar.
-- 2. De leesregels van set_logs, workout_exercises en workouts houden alles wat ze al toestonden en
--    krijgen er één voorwaarde bij:
--    - set_logs: je eigen sets mag je altijd lezen.
--    - workout_exercises: een oefening waarin je zelf sets hebt gelogd.
--    - workouts: een training waarin je zelf sets hebt gelogd.
--
-- Wat verandert er NIET?
-- - De schrijfregels ("sets write" en die van oefeningen en trainingen) blijven zoals ze zijn. Wie geen lid
--   meer is, kan oude sets dus alleen nog bekijken, niet aanpassen of verwijderen.
-- - Een ex-lid ziet in een oude training alleen de oefeningen waarin hij zelf sets heeft gelogd, en
--   alleen zijn eigen sets (plus die van vrienden, zoals al het geval was). Groepsleden, opmerkingen en
--   andere oefeningen blijven afgeschermd.
-- - Een trainer die de groep verlaat, houdt geen extra rechten over: ook hij leest alleen via zijn eigen sets.
-- - Wordt de groep verwijderd, dan worden de trainingen en alle sets daarin nog steeds verwijderd.

-- ─────────────── Hulpfuncties ───────────────

-- Heb ik zelf sets gelogd in deze oefening?
create or replace function public.own_logged_wex(weid uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (select 1 from set_logs where workout_exercise_id = weid and user_id = (select auth.uid()));
$$;

-- Heb ik zelf sets gelogd in deze training?
create or replace function public.own_logged_workout(wid uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from set_logs sl join workout_exercises we on we.id = sl.workout_exercise_id
    where we.workout_id = wid and sl.user_id = (select auth.uid())
  );
$$;

revoke execute on function public.own_logged_wex(uuid) from public, anon;
revoke execute on function public.own_logged_workout(uuid) from public, anon;
grant execute on function public.own_logged_wex(uuid) to authenticated;
grant execute on function public.own_logged_workout(uuid) to authenticated;

-- ─────────────── Leesregels ───────────────

-- Sets: eigen sets eerst (goedkoopste controle), dan groep en vrienden zoals voorheen.
-- (select auth.uid()) wordt één keer per query bepaald in plaats van per rij; dat scheelt bij een
-- volledige synchronisatie van de eigen geschiedenis.
drop policy if exists "sets read" on public.set_logs;
create policy "sets read" on public.set_logs for select to authenticated
  using (
    user_id = (select auth.uid())
    or public.is_member(public.workout_exercise_group(workout_exercise_id))
    or public.is_friend(user_id)
  );

-- Oefeningen in een training: groep, vrienden, of zelf gelogd.
drop policy if exists "wex read" on public.workout_exercises;
create policy "wex read" on public.workout_exercises for select to authenticated
  using (
    public.is_member(public.workout_group(workout_id))
    or public.friend_logged_wex(id)
    or public.own_logged_wex(id)
  );

-- Trainingen: groep, vrienden, of zelf gelogd.
drop policy if exists "workouts read" on public.workouts;
create policy "workouts read" on public.workouts for select to authenticated
  using (
    public.is_member(group_id)
    or public.friend_logged_workout(id)
    or public.own_logged_workout(id)
  );
