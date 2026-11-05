-- Groepen: betrouwbaarder opslaan, geen dubbele records, laatste trainer beschermd, lichtere ranglijst.
-- Plak dit in Supabase → SQL Editor → New query → Run (na schema.sql en features.sql).
-- Veilig om opnieuw te draaien. De app werkt ook zonder dit script (met een tragere/minder veilige terugval).

-- ─────────────── Training plannen in één transactie ───────────────
-- p_items = [{ "id": "<uuid of null>", "slug": "...", "sets": 3, "reps": "8-12", "notes": "..." }]
-- Bestaande oefeningen (met id) worden bijgewerkt zodat gelogde sets behouden blijven.
create or replace function public.save_group_workout(
  p_group_id uuid,
  p_workout_id uuid,
  p_title text,
  p_date date,
  p_notes text,
  p_items jsonb
)
returns uuid language plpgsql security invoker set search_path = public as $$
declare
  wid uuid;
  keep uuid[];
begin
  if not public.is_trainer(p_group_id) then
    raise exception 'Alleen trainers kunnen trainingen plannen' using errcode = '42501';
  end if;
  if coalesce(trim(p_title), '') = '' then
    raise exception 'Geef de training een titel';
  end if;

  if p_workout_id is null then
    insert into workouts (group_id, title, date, notes)
    values (p_group_id, trim(p_title), p_date, nullif(trim(p_notes), ''))
    returning id into wid;
  else
    update workouts set title = trim(p_title), date = p_date, notes = nullif(trim(p_notes), '')
    where id = p_workout_id and group_id = p_group_id
    returning id into wid;
    if wid is null then
      raise exception 'Training niet gevonden in deze groep';
    end if;
  end if;

  select coalesce(array_agg((e ->> 'id')::uuid), '{}')
  into keep
  from jsonb_array_elements(p_items) e
  where nullif(e ->> 'id', '') is not null;

  delete from workout_exercises where workout_id = wid and not (id = any (keep));

  update workout_exercises we
  set exercise_slug = x.slug, position = x.pos, target_sets = x.sets, target_reps = x.reps, notes = x.notes
  from (
    select (e ->> 'id')::uuid as id,
           e ->> 'slug' as slug,
           (ord - 1)::int as pos,
           greatest(1, coalesce((e ->> 'sets')::int, 3)) as sets,
           coalesce(nullif(trim(e ->> 'reps'), ''), '8-12') as reps,
           nullif(trim(e ->> 'notes'), '') as notes
    from jsonb_array_elements(p_items) with ordinality as t (e, ord)
    where nullif(e ->> 'id', '') is not null
  ) x
  where we.id = x.id and we.workout_id = wid;

  insert into workout_exercises (workout_id, exercise_slug, position, target_sets, target_reps, notes)
  select wid,
         e ->> 'slug',
         (ord - 1)::int,
         greatest(1, coalesce((e ->> 'sets')::int, 3)),
         coalesce(nullif(trim(e ->> 'reps'), ''), '8-12'),
         nullif(trim(e ->> 'notes'), '')
  from jsonb_array_elements(p_items) with ordinality as t (e, ord)
  where nullif(e ->> 'id', '') is null;

  return wid;
end;
$$;

grant execute on function public.save_group_workout(uuid, uuid, text, date, text, jsonb) to authenticated;

-- ─────────────── Laatste trainer kan niet weg ───────────────
-- Een groep met andere leden houdt altijd minstens één trainer. Verwijderen van de hele groep
-- (cascade) of van een account blijft gewoon mogelijk.
create or replace function public.guard_last_trainer()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if old.role <> 'trainer' then
    return case when tg_op = 'DELETE' then old else new end;
  end if;
  if tg_op = 'UPDATE' and new.role = 'trainer' then
    return new;
  end if;
  -- Cascade vanuit groups/profiles: de groep of het profiel bestaat dan al niet meer.
  if pg_trigger_depth() > 1
     or not exists (select 1 from groups where id = old.group_id)
     or not exists (select 1 from profiles where id = old.user_id) then
    return case when tg_op = 'DELETE' then old else new end;
  end if;
  if exists (
       select 1 from group_members
       where group_id = old.group_id and user_id <> old.user_id and role = 'trainer'
     )
     or not exists (
       select 1 from group_members where group_id = old.group_id and user_id <> old.user_id
     ) then
    return case when tg_op = 'DELETE' then old else new end;
  end if;
  raise exception 'Maak eerst iemand anders trainer: een groep heeft altijd een trainer nodig';
end;
$$;

drop trigger if exists group_members_last_trainer on public.group_members;
create trigger group_members_last_trainer
  before delete or update of role on public.group_members
  for each row execute function public.guard_last_trainer();

-- ─────────────── Eén record-activiteit per training en oefening ───────────────
-- Eerst eventuele dubbelingen opruimen (de eerste blijft staan, met zijn Respect).
delete from public.activities a
using public.activities b
where a.type = 'pr' and b.type = 'pr'
  and a.workout_id = b.workout_id
  and a.user_id = b.user_id
  and a.payload ->> 'slug' = b.payload ->> 'slug'
  and (a.created_at, a.id) > (b.created_at, b.id);

create unique index if not exists activities_pr_once
  on public.activities (workout_id, user_id, (payload ->> 'slug'))
  where type = 'pr';

-- ─────────────── Respect live tonen ───────────────
do $$
begin
  begin
    alter publication supabase_realtime add table public.activity_kudos;
  exception when duplicate_object then null;
  end;
end $$;

-- ─────────────── Ranglijst: alleen de beste sets ───────────────
-- Per lid, oefening en gewicht het hoogste aantal reps (en het hoogste aantal t/m 12 reps, want
-- daarboven telt een set niet mee voor de 1RM-schatting). Dat is genoeg om exact dezelfde rang
-- te berekenen als met alle sets, maar een fractie van de data.
-- security definer met lidmaatschapscontrole: elk lid ziet dezelfde ranglijst (ook van leden die
-- geen vriend zijn), en de RLS-functie hoeft niet per set te draaien. Er gaan alleen
-- samengevatte beste sets terug, geen losse trainingen en zeker geen voeding.
create or replace function public.group_best_sets(gid uuid)
returns table (user_id uuid, exercise_slug text, weight numeric, reps int, reps12 int)
language plpgsql stable security definer set search_path = public as $$
#variable_conflict use_column
begin
  if not public.is_member(gid) then
    raise exception 'Je bent geen lid van deze groep' using errcode = '42501';
  end if;
  return query
  select s.user_id,
         we.exercise_slug,
         coalesce(s.weight, 0)::numeric as weight,
         max(s.reps)::int as reps,
         (max(s.reps) filter (where s.reps <= 12))::int as reps12
  from set_logs s
  join workout_exercises we on we.id = s.workout_exercise_id
  where s.reps is not null
    and s.reps > 0
    and s.user_id in (select m.user_id from group_members m where m.group_id = gid)
  group by s.user_id, we.exercise_slug, coalesce(s.weight, 0);
end;
$$;

grant execute on function public.group_best_sets(uuid) to authenticated;

-- ─────────────── Aanwezigheid per training ───────────────
-- Wie er per training minstens één set logde (welk setnummer dan ook), zonder rij-limiet.
create or replace function public.group_attendance(wids uuid[])
returns table (workout_id uuid, user_id uuid)
language sql stable security definer set search_path = public as $$
  select distinct we.workout_id, s.user_id
  from set_logs s
  join workout_exercises we on we.id = s.workout_exercise_id
  join workouts w on w.id = we.workout_id
  where we.workout_id = any (wids)
    and s.reps is not null
    and s.reps > 0
    and w.group_id in (select m.group_id from group_members m where m.user_id = auth.uid());
$$;

grant execute on function public.group_attendance(uuid[]) to authenticated;

-- ─────────────── Groep verlaten (met overdracht) in één transactie ───────────────
create or replace function public.leave_group(gid uuid, successor uuid default null)
returns void language plpgsql security definer set search_path = public as $$
declare
  my_role text;
begin
  if auth.uid() is null then
    raise exception 'Niet ingelogd';
  end if;
  select role into my_role from group_members where group_id = gid and user_id = auth.uid();
  if my_role is null then
    raise exception 'Je bent geen lid (meer) van deze groep';
  end if;
  if successor is not null and successor <> auth.uid() then
    if my_role <> 'trainer' then
      raise exception 'Alleen een trainer kan de groep overdragen' using errcode = '42501';
    end if;
    update group_members set role = 'trainer' where group_id = gid and user_id = successor;
    if not found then
      raise exception 'Deze persoon is geen lid meer van de groep';
    end if;
  end if;
  delete from group_members where group_id = gid and user_id = auth.uid();
end;
$$;

grant execute on function public.leave_group(uuid, uuid) to authenticated;

-- ─────────────── Eén promotie per training, oefening en rang ───────────────
delete from public.activities a
using public.activities b
where a.type = 'promotion' and b.type = 'promotion'
  and a.workout_id = b.workout_id
  and a.user_id = b.user_id
  and a.payload ->> 'slug' = b.payload ->> 'slug'
  and coalesce(a.payload ->> 'tierIndex', '0') = coalesce(b.payload ->> 'tierIndex', '0')
  and (a.created_at, a.id) > (b.created_at, b.id);

create unique index if not exists activities_promotion_once
  on public.activities (workout_id, user_id, (payload ->> 'slug'), (coalesce(payload ->> 'tierIndex', '0')))
  where type = 'promotion';

-- ─────────────── "Training afgerond" in de feed ───────────────
do $$
begin
  alter table public.activities drop constraint if exists activities_type_check;
  alter table public.activities
    add constraint activities_type_check check (type in ('pr', 'promotion', 'joined', 'finished'));
end $$;

delete from public.activities a
using public.activities b
where a.type = 'finished' and b.type = 'finished'
  and a.workout_id = b.workout_id
  and a.user_id = b.user_id
  and (a.created_at, a.id) > (b.created_at, b.id);

create unique index if not exists activities_finished_once
  on public.activities (workout_id, user_id)
  where type = 'finished';

-- Bijwerken van de samenvatting (bijv. een set achteraf toegevoegd) door wie hem plaatste.
drop policy if exists "activities update own" on public.activities;
create policy "activities update own" on public.activities for update to authenticated
  using (created_by = auth.uid() or user_id = auth.uid())
  with check (public.is_member(group_id) and (user_id = auth.uid() or public.is_trainer(group_id)));

-- ─────────────── Groepspagina live: geplande trainingen en leden ───────────────
-- Plant de trainer een training of komt er een lid bij, dan zien open groepspagina's dat meteen.
-- Zonder dit blok ververst de pagina gewoon af en toe.
do $$
begin
  begin
    alter publication supabase_realtime add table public.workouts;
  exception when duplicate_object then null;
  end;
  begin
    alter publication supabase_realtime add table public.group_members;
  exception when duplicate_object then null;
  end;
end $$;
