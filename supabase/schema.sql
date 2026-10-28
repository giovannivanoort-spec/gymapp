-- GymApp database-schema
-- Plak dit hele bestand in Supabase → SQL Editor → New query → Run.
-- Je kunt het veilig opnieuw draaien.

-- ─────────────────────────── Tabellen ───────────────────────────

create table if not exists public.profiles (
  id uuid primary key references auth.users (id) on delete cascade,
  display_name text not null default 'Sporter',
  created_at timestamptz not null default now()
);

create table if not exists public.groups (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  invite_code text not null unique default substr(md5(random()::text), 1, 8),
  created_by uuid not null default auth.uid() references public.profiles (id) on delete cascade,
  created_at timestamptz not null default now()
);

create table if not exists public.group_members (
  group_id uuid not null references public.groups (id) on delete cascade,
  user_id uuid not null references public.profiles (id) on delete cascade,
  role text not null default 'member' check (role in ('trainer', 'member')),
  joined_at timestamptz not null default now(),
  primary key (group_id, user_id)
);

create table if not exists public.workouts (
  id uuid primary key default gen_random_uuid(),
  group_id uuid not null references public.groups (id) on delete cascade,
  date date not null,
  title text not null,
  notes text,
  created_by uuid not null default auth.uid() references public.profiles (id),
  created_at timestamptz not null default now()
);
create index if not exists workouts_group_date on public.workouts (group_id, date desc);

create table if not exists public.workout_exercises (
  id uuid primary key default gen_random_uuid(),
  workout_id uuid not null references public.workouts (id) on delete cascade,
  exercise_slug text not null,
  position int not null default 0,
  target_sets int not null default 3,
  target_reps text not null default '8-12',
  notes text
);
create index if not exists workout_exercises_workout on public.workout_exercises (workout_id, position);

create table if not exists public.set_logs (
  id uuid primary key default gen_random_uuid(),
  workout_exercise_id uuid not null references public.workout_exercises (id) on delete cascade,
  user_id uuid not null default auth.uid() references public.profiles (id) on delete cascade,
  set_number int not null,
  reps int,
  weight numeric(6, 2),
  created_at timestamptz not null default now(),
  unique (workout_exercise_id, user_id, set_number)
);
create index if not exists set_logs_user on public.set_logs (user_id);

create table if not exists public.comments (
  id uuid primary key default gen_random_uuid(),
  workout_id uuid not null references public.workouts (id) on delete cascade,
  workout_exercise_id uuid references public.workout_exercises (id) on delete cascade,
  user_id uuid not null default auth.uid() references public.profiles (id) on delete cascade,
  body text not null check (length(body) between 1 and 2000),
  created_at timestamptz not null default now()
);
create index if not exists comments_workout on public.comments (workout_id, created_at);

-- Herbruikbare trainingsschema's van een trainer.
-- exercises = [{ "slug": "...", "sets": 3, "reps": "8-12", "notes": "..." }]
create table if not exists public.templates (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null default auth.uid() references public.profiles (id) on delete cascade,
  name text not null,
  exercises jsonb not null default '[]'::jsonb,
  created_at timestamptz not null default now()
);

-- Zelfgekozen YouTube-video per oefening (geldt voor iedereen).
create table if not exists public.exercise_videos (
  exercise_slug text primary key,
  youtube_id text not null,
  updated_by uuid default auth.uid() references public.profiles (id) on delete set null,
  updated_at timestamptz not null default now()
);

-- ─────────────────────────── Hulpfuncties ───────────────────────────
-- security definer zodat de RLS-policies hieronder niet in een lus belanden.

create or replace function public.is_member(gid uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (select 1 from group_members where group_id = gid and user_id = auth.uid());
$$;

create or replace function public.is_trainer(gid uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from group_members where group_id = gid and user_id = auth.uid() and role = 'trainer'
  );
$$;

create or replace function public.workout_group(wid uuid)
returns uuid language sql stable security definer set search_path = public as $$
  select group_id from workouts where id = wid;
$$;

create or replace function public.workout_exercise_group(weid uuid)
returns uuid language sql stable security definer set search_path = public as $$
  select w.group_id from workout_exercises we join workouts w on w.id = we.workout_id where we.id = weid;
$$;

-- Profiel aanmaken bij registratie.
create or replace function public.handle_new_user()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  insert into profiles (id, display_name)
  values (new.id, coalesce(nullif(new.raw_user_meta_data ->> 'display_name', ''), split_part(new.email, '@', 1)))
  on conflict (id) do nothing;
  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created after insert on auth.users
  for each row execute function public.handle_new_user();

-- Maker van een groep wordt automatisch trainer.
create or replace function public.handle_new_group()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  insert into group_members (group_id, user_id, role) values (new.id, new.created_by, 'trainer')
  on conflict do nothing;
  return new;
end;
$$;

drop trigger if exists on_group_created on public.groups;
create trigger on_group_created after insert on public.groups
  for each row execute function public.handle_new_group();

-- Lid worden via uitnodigingscode.
create or replace function public.join_group(code text)
returns uuid language plpgsql security definer set search_path = public as $$
declare gid uuid;
begin
  if auth.uid() is null then raise exception 'Niet ingelogd'; end if;
  select id into gid from groups where invite_code = lower(trim(code));
  if gid is null then raise exception 'Ongeldige uitnodigingscode'; end if;
  insert into group_members (group_id, user_id, role) values (gid, auth.uid(), 'member')
  on conflict do nothing;
  return gid;
end;
$$;

-- Groepsnaam bekijken vóór je lid wordt (alleen naam + aantal leden).
create or replace function public.group_preview(code text)
returns table (id uuid, name text, member_count bigint)
language sql stable security definer set search_path = public as $$
  select g.id, g.name, (select count(*) from group_members m where m.group_id = g.id)
  from groups g where g.invite_code = lower(trim(code));
$$;

grant execute on function public.join_group(text) to authenticated;
grant execute on function public.group_preview(text) to authenticated;

-- ─────────────────────────── Row Level Security ───────────────────────────

alter table public.profiles enable row level security;
alter table public.groups enable row level security;
alter table public.group_members enable row level security;
alter table public.workouts enable row level security;
alter table public.workout_exercises enable row level security;
alter table public.set_logs enable row level security;
alter table public.comments enable row level security;
alter table public.templates enable row level security;
alter table public.exercise_videos enable row level security;

-- profiles
drop policy if exists "profiles read" on public.profiles;
create policy "profiles read" on public.profiles for select to authenticated using (true);
drop policy if exists "profiles update own" on public.profiles;
create policy "profiles update own" on public.profiles for update to authenticated
  using (id = auth.uid()) with check (id = auth.uid());

-- groups
drop policy if exists "groups read" on public.groups;
create policy "groups read" on public.groups for select to authenticated
  using (public.is_member(id) or created_by = auth.uid());
drop policy if exists "groups insert" on public.groups;
create policy "groups insert" on public.groups for insert to authenticated
  with check (created_by = auth.uid());
drop policy if exists "groups update" on public.groups;
create policy "groups update" on public.groups for update to authenticated
  using (public.is_trainer(id));
drop policy if exists "groups delete" on public.groups;
create policy "groups delete" on public.groups for delete to authenticated
  using (public.is_trainer(id));

-- group_members
drop policy if exists "members read" on public.group_members;
create policy "members read" on public.group_members for select to authenticated
  using (public.is_member(group_id));
drop policy if exists "members update" on public.group_members;
create policy "members update" on public.group_members for update to authenticated
  using (public.is_trainer(group_id));
drop policy if exists "members delete" on public.group_members;
create policy "members delete" on public.group_members for delete to authenticated
  using (public.is_trainer(group_id) or user_id = auth.uid());

-- workouts
drop policy if exists "workouts read" on public.workouts;
create policy "workouts read" on public.workouts for select to authenticated
  using (public.is_member(group_id));
drop policy if exists "workouts write" on public.workouts;
create policy "workouts write" on public.workouts for all to authenticated
  using (public.is_trainer(group_id)) with check (public.is_trainer(group_id));

-- workout_exercises
drop policy if exists "wex read" on public.workout_exercises;
create policy "wex read" on public.workout_exercises for select to authenticated
  using (public.is_member(public.workout_group(workout_id)));
drop policy if exists "wex write" on public.workout_exercises;
create policy "wex write" on public.workout_exercises for all to authenticated
  using (public.is_trainer(public.workout_group(workout_id)))
  with check (public.is_trainer(public.workout_group(workout_id)));

-- set_logs: iedereen in de groep ziet ze, je schrijft je eigen sets.
-- Een trainer mag ook sets invullen voor groepsleden (handig als je iemand traint).
drop policy if exists "sets read" on public.set_logs;
create policy "sets read" on public.set_logs for select to authenticated
  using (public.is_member(public.workout_exercise_group(workout_exercise_id)));
drop policy if exists "sets write" on public.set_logs;
create policy "sets write" on public.set_logs for all to authenticated
  using (
    (user_id = auth.uid() and public.is_member(public.workout_exercise_group(workout_exercise_id)))
    or public.is_trainer(public.workout_exercise_group(workout_exercise_id))
  )
  with check (
    (user_id = auth.uid() and public.is_member(public.workout_exercise_group(workout_exercise_id)))
    or public.is_trainer(public.workout_exercise_group(workout_exercise_id))
  );

-- comments
drop policy if exists "comments read" on public.comments;
create policy "comments read" on public.comments for select to authenticated
  using (public.is_member(public.workout_group(workout_id)));
drop policy if exists "comments insert" on public.comments;
create policy "comments insert" on public.comments for insert to authenticated
  with check (user_id = auth.uid() and public.is_member(public.workout_group(workout_id)));
drop policy if exists "comments delete" on public.comments;
create policy "comments delete" on public.comments for delete to authenticated
  using (user_id = auth.uid() or public.is_trainer(public.workout_group(workout_id)));

-- templates: alleen van jezelf
drop policy if exists "templates own" on public.templates;
create policy "templates own" on public.templates for all to authenticated
  using (owner_id = auth.uid()) with check (owner_id = auth.uid());

-- exercise_videos: iedereen leest, ingelogde gebruikers mogen een video instellen
drop policy if exists "videos read" on public.exercise_videos;
create policy "videos read" on public.exercise_videos for select to authenticated using (true);
drop policy if exists "videos write" on public.exercise_videos;
create policy "videos write" on public.exercise_videos for all to authenticated
  using (true) with check (true);

-- ─────────────────────────── Realtime ───────────────────────────
-- Zodat je live ziet wanneer een vriend een set of opmerking toevoegt.
do $$
begin
  begin
    alter publication supabase_realtime add table public.set_logs;
  exception when duplicate_object then null;
  end;
  begin
    alter publication supabase_realtime add table public.comments;
  exception when duplicate_object then null;
  end;
end $$;
