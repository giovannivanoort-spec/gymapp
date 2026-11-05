  -- Vriendschappen: verzoeken via een persoonlijke vriendcode of vanuit je groep, en vrienden mogen
  -- elkaars trainingen, sets, ranks en lichaamsgewicht zien (voeding blijft privé).
  -- Plak dit in Supabase → SQL Editor → New query → Run (na de eerdere scripts). Veilig om opnieuw te draaien.
  -- LET OP: draai dit script NIET opnieuw nadat supabase/upgrade-social.sql is gedraaid: dat zet de
  -- oude (openbare) vriendcode-functies terug. Is het toch gebeurd, draai dan upgrade-social.sql nog een keer.
  
  -- ─────────────── Vriendcode ───────────────
  alter table public.profiles add column if not exists friend_code text;
  update public.profiles set friend_code = substr(md5(random()::text || id::text), 1, 8) where friend_code is null;
  alter table public.profiles alter column friend_code set default substr(md5(random()::text), 1, 8);
  alter table public.profiles alter column friend_code set not null;
  create unique index if not exists profiles_friend_code on public.profiles (friend_code);
  
  -- ─────────────── Vriendschappen ───────────────
  create table if not exists public.friendships (
    requester uuid not null references public.profiles (id) on delete cascade,
    addressee uuid not null references public.profiles (id) on delete cascade,
    status text not null default 'pending' check (status in ('pending', 'accepted')),
    created_at timestamptz not null default now(),
    accepted_at timestamptz,
    primary key (requester, addressee),
    check (requester <> addressee)
  );
  create index if not exists friendships_addressee on public.friendships (addressee, status);
  
  alter table public.friendships enable row level security;
  drop policy if exists "friendships read own" on public.friendships;
  create policy "friendships read own" on public.friendships for select to authenticated
    using (requester = auth.uid() or addressee = auth.uid());
  -- Schrijven gaat alleen via de functies hieronder.
  
  create or replace function public.is_friend(uid uuid)
  returns boolean language sql stable security definer set search_path = public as $$
    select exists (
      select 1 from friendships
      where status = 'accepted'
        and ((requester = auth.uid() and addressee = uid) or (addressee = auth.uid() and requester = uid))
    );
  $$;
  
  -- Verzoek sturen (of een openstaand verzoek van de ander direct accepteren).
  create or replace function public.request_friend(target uuid)
  returns text language plpgsql security definer set search_path = public as $$
  declare me uuid := auth.uid();
  begin
    if me is null then raise exception 'Niet ingelogd'; end if;
    if target is null or target = me then return 'self'; end if;
    if not exists (select 1 from profiles where id = target) then raise exception 'Gebruiker niet gevonden'; end if;
    if exists (select 1 from friendships where status = 'accepted'
               and ((requester = me and addressee = target) or (requester = target and addressee = me))) then
      return 'already';
    end if;
    if exists (select 1 from friendships where requester = target and addressee = me and status = 'pending') then
      update friendships set status = 'accepted', accepted_at = now() where requester = target and addressee = me;
      return 'accepted';
    end if;
    insert into friendships (requester, addressee) values (me, target) on conflict do nothing;
    return 'requested';
  end;
  $$;
  
  -- Met iemands vriendcode (die hij zelf heeft gedeeld) ben je direct vrienden.
  create or replace function public.request_friend_by_code(code text)
  returns text language plpgsql security definer set search_path = public as $$
  declare me uuid := auth.uid(); target uuid;
  begin
    if me is null then raise exception 'Niet ingelogd'; end if;
    select id into target from profiles where friend_code = lower(trim(code));
    if target is null then raise exception 'Onbekende vriendcode'; end if;
    if target = me then return 'self'; end if;
    if public.is_friend(target) then return 'already'; end if;
    delete from friendships where (requester = me and addressee = target) or (requester = target and addressee = me);
    insert into friendships (requester, addressee, status, accepted_at) values (me, target, 'accepted', now());
    return 'accepted';
  end;
  $$;
  
  -- Naam bekijken bij een vriendcode (voor de uitnodigingspagina).
  create or replace function public.friend_code_preview(code text)
  returns table (id uuid, display_name text)
  language sql stable security definer set search_path = public as $$
    select id, display_name from profiles where friend_code = lower(trim(code));
  $$;
  
  create or replace function public.respond_friend(requester_id uuid, accept boolean)
  returns void language plpgsql security definer set search_path = public as $$
  begin
    if accept then
      update friendships set status = 'accepted', accepted_at = now()
      where requester = requester_id and addressee = auth.uid() and status = 'pending';
    else
      delete from friendships where requester = requester_id and addressee = auth.uid() and status = 'pending';
    end if;
  end;
  $$;
  
  create or replace function public.remove_friend(other uuid)
  returns void language sql security definer set search_path = public as $$
    delete from friendships
    where (requester = auth.uid() and addressee = other) or (requester = other and addressee = auth.uid());
  $$;
  
  grant execute on function public.request_friend(uuid) to authenticated;
  grant execute on function public.request_friend_by_code(text) to authenticated;
  grant execute on function public.friend_code_preview(text) to authenticated;
  grant execute on function public.respond_friend(uuid, boolean) to authenticated;
  grant execute on function public.remove_friend(uuid) to authenticated;
  
  -- ─────────────── Vrienden mogen elkaars trainingen zien ───────────────
  -- Heeft een vriend sets gelogd in deze oefening / training?
  create or replace function public.friend_logged_wex(weid uuid)
  returns boolean language sql stable security definer set search_path = public as $$
    select exists (select 1 from set_logs where workout_exercise_id = weid and public.is_friend(user_id));
  $$;
  
  create or replace function public.friend_logged_workout(wid uuid)
  returns boolean language sql stable security definer set search_path = public as $$
    select exists (
      select 1 from set_logs sl join workout_exercises we on we.id = sl.workout_exercise_id
      where we.workout_id = wid and public.is_friend(sl.user_id)
    );
  $$;
  
  drop policy if exists "sets read" on public.set_logs;
  create policy "sets read" on public.set_logs for select to authenticated
    using (public.is_member(public.workout_exercise_group(workout_exercise_id)) or public.is_friend(user_id));
  
  drop policy if exists "wex read" on public.workout_exercises;
  create policy "wex read" on public.workout_exercises for select to authenticated
    using (public.is_member(public.workout_group(workout_id)) or public.friend_logged_wex(id));
  
  drop policy if exists "workouts read" on public.workouts;
  create policy "workouts read" on public.workouts for select to authenticated
    using (public.is_member(group_id) or public.friend_logged_workout(id));
  
  drop policy if exists "bodyweight read" on public.bodyweight_logs;
  create policy "bodyweight read" on public.bodyweight_logs for select to authenticated
    using (user_id = auth.uid() or public.shares_group(user_id) or public.is_friend(user_id));
