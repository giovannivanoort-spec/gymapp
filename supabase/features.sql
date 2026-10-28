-- Extra functies: lichaamsgewicht-log, weekdoel, groepsfeed met reacties, pushmeldingen.
-- Plak dit in Supabase → SQL Editor → New query → Run (na de eerdere scripts). Veilig om opnieuw te draaien.

-- ─────────────── Weekdoel ───────────────
alter table public.profiles add column if not exists weekly_goal int not null default 3
  check (weekly_goal between 1 and 7);

-- ─────────────── Lichaamsgewicht over tijd ───────────────
create table if not exists public.bodyweight_logs (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references public.profiles (id) on delete cascade,
  date date not null default current_date,
  weight_kg numeric(5, 1) not null check (weight_kg between 30 and 300),
  created_at timestamptz not null default now(),
  unique (user_id, date)
);
create index if not exists bodyweight_logs_user on public.bodyweight_logs (user_id, date);

-- Deelt de huidige gebruiker een groep met deze persoon?
create or replace function public.shares_group(uid uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from group_members a join group_members b on a.group_id = b.group_id
    where a.user_id = auth.uid() and b.user_id = uid
  );
$$;

alter table public.bodyweight_logs enable row level security;
drop policy if exists "bodyweight read" on public.bodyweight_logs;
create policy "bodyweight read" on public.bodyweight_logs for select to authenticated
  using (user_id = auth.uid() or public.shares_group(user_id));
drop policy if exists "bodyweight write own" on public.bodyweight_logs;
create policy "bodyweight write own" on public.bodyweight_logs for all to authenticated
  using (user_id = auth.uid()) with check (user_id = auth.uid());

-- ─────────────── Groepsfeed ───────────────
-- type: 'pr' (persoonlijk record), 'promotion' (nieuwe rang), 'joined' (lid geworden)
create table if not exists public.activities (
  id uuid primary key default gen_random_uuid(),
  group_id uuid not null references public.groups (id) on delete cascade,
  user_id uuid not null references public.profiles (id) on delete cascade,
  type text not null check (type in ('pr', 'promotion', 'joined')),
  payload jsonb not null default '{}'::jsonb,
  workout_id uuid references public.workouts (id) on delete cascade,
  created_by uuid not null default auth.uid() references public.profiles (id) on delete cascade,
  created_at timestamptz not null default now()
);
create index if not exists activities_group on public.activities (group_id, created_at desc);

create table if not exists public.activity_kudos (
  activity_id uuid not null references public.activities (id) on delete cascade,
  user_id uuid not null default auth.uid() references public.profiles (id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (activity_id, user_id)
);

create or replace function public.activity_group(aid uuid)
returns uuid language sql stable security definer set search_path = public as $$
  select group_id from activities where id = aid;
$$;

alter table public.activities enable row level security;
alter table public.activity_kudos enable row level security;

drop policy if exists "activities read" on public.activities;
create policy "activities read" on public.activities for select to authenticated
  using (public.is_member(group_id));
-- Je mag een activiteit plaatsen voor jezelf, of als trainer voor een lid (als je hun sets invult).
drop policy if exists "activities insert" on public.activities;
create policy "activities insert" on public.activities for insert to authenticated
  with check (
    created_by = auth.uid()
    and public.is_member(group_id)
    and (user_id = auth.uid() or public.is_trainer(group_id))
  );
drop policy if exists "activities delete" on public.activities;
create policy "activities delete" on public.activities for delete to authenticated
  using (created_by = auth.uid() or user_id = auth.uid() or public.is_trainer(group_id));

drop policy if exists "kudos read" on public.activity_kudos;
create policy "kudos read" on public.activity_kudos for select to authenticated
  using (public.is_member(public.activity_group(activity_id)));
drop policy if exists "kudos write own" on public.activity_kudos;
create policy "kudos write own" on public.activity_kudos for all to authenticated
  using (user_id = auth.uid())
  with check (user_id = auth.uid() and public.is_member(public.activity_group(activity_id)));

-- Lid worden plaatst automatisch een "lid geworden"-activiteit.
create or replace function public.join_group(code text)
returns uuid language plpgsql security definer set search_path = public as $$
declare gid uuid; inserted int;
begin
  if auth.uid() is null then raise exception 'Niet ingelogd'; end if;
  select id into gid from groups where invite_code = lower(trim(code));
  if gid is null then raise exception 'Ongeldige uitnodigingscode'; end if;
  insert into group_members (group_id, user_id, role) values (gid, auth.uid(), 'member')
  on conflict do nothing;
  get diagnostics inserted = row_count;
  if inserted > 0 then
    insert into activities (group_id, user_id, type, created_by) values (gid, auth.uid(), 'joined', auth.uid());
  end if;
  return gid;
end;
$$;

do $$
begin
  begin
    alter publication supabase_realtime add table public.activities;
  exception when duplicate_object then null;
  end;
end $$;

-- ─────────────── Pushmeldingen ───────────────
create table if not exists public.push_subscriptions (
  endpoint text primary key,
  user_id uuid not null default auth.uid() references public.profiles (id) on delete cascade,
  p256dh text not null,
  auth text not null,
  created_at timestamptz not null default now()
);
create index if not exists push_subscriptions_user on public.push_subscriptions (user_id);

alter table public.push_subscriptions enable row level security;
drop policy if exists "push own" on public.push_subscriptions;
create policy "push own" on public.push_subscriptions for all to authenticated
  using (user_id = auth.uid()) with check (user_id = auth.uid());
-- Het versturen gebeurt op de server met de secret key (die omzeilt RLS).
