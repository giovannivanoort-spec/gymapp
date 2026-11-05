-- Vrienden: live bijwerken, privé vriendcodes, verzoek-status terugmelden en account verwijderen.
-- Plak dit in Supabase -> SQL Editor -> New query -> Run (na friends.sql). Veilig om opnieuw te draaien.
-- Zonder dit script werkt alles nog steeds; de lijst ververst dan bij terugkeren naar de app en elke
-- 15 seconden, vriendcodes staan dan nog in profiles en "Account verwijderen" meldt dat het nog niet kan.
--
-- LET OP: draai friends.sql hierna niet opnieuw; dat zet de oude (openbare) vriendcode-functies terug.
-- Gebeurt het toch, draai dan dit script nog een keer.

-- ─────────────── Realtime ───────────────
-- friendships zelf staat NIET in de realtime-publicatie: verwijderingen (ontvrienden, weigeren,
-- intrekken) gaan via Realtime zonder RLS naar iedere luisteraar, met beide gebruikers-id's erin.
-- In plaats daarvan krijgt elke betrokkene een "ping"-rij die alleen hijzelf kan lezen; die rij
-- wordt alleen toegevoegd of bijgewerkt (nooit verwijderd), dus Realtime past RLS altijd toe.
create table if not exists public.friendship_pings (
  user_id uuid primary key,
  changed_at timestamptz not null default now()
);
alter table public.friendship_pings enable row level security;
drop policy if exists "friendship pings read own" on public.friendship_pings;
create policy "friendship pings read own" on public.friendship_pings for select to authenticated
  using (user_id = auth.uid());

create or replace function public.ping_friendship_change()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if tg_op = 'DELETE' then
    insert into friendship_pings (user_id) values (old.requester), (old.addressee)
      on conflict (user_id) do update set changed_at = now();
  else
    insert into friendship_pings (user_id) values (new.requester), (new.addressee)
      on conflict (user_id) do update set changed_at = now();
  end if;
  return null;
end;
$$;
revoke all on function public.ping_friendship_change() from public, anon, authenticated;

drop trigger if exists friendships_ping on public.friendships;
create trigger friendships_ping after insert or update or delete on public.friendships
  for each row execute function public.ping_friendship_change();

do $$
begin
  -- Eerdere versie van dit script zette friendships in de publicatie: weer weghalen.
  if exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'friendships'
  ) then
    alter publication supabase_realtime drop table public.friendships;
  end if;
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'friendship_pings'
  ) then
    alter publication supabase_realtime add table public.friendship_pings;
  end if;
exception
  -- Geen realtime-publicatie (bijv. lokaal zonder Supabase Realtime): niets te doen.
  when undefined_object then null;
end $$;

-- ─────────────── Vriendcodes in een eigen tabel (alleen je eigen code is leesbaar) ───────────────
create table if not exists public.friend_codes (
  user_id uuid primary key references public.profiles (id) on delete cascade,
  code text not null unique check (code ~ '^[a-f0-9]{8}$'),
  created_at timestamptz not null default now()
);
alter table public.friend_codes enable row level security;
drop policy if exists "friend codes read own" on public.friend_codes;
create policy "friend codes read own" on public.friend_codes for select to authenticated
  using (user_id = auth.uid());
-- Schrijven gaat alleen via de functies hieronder.

-- Bestaande codes overnemen (zodat gedeelde links blijven werken) en daarna uit profiles wissen,
-- want profiles is voor iedere ingelogde gebruiker leesbaar.
do $$
begin
  if exists (select 1 from information_schema.columns
             where table_schema = 'public' and table_name = 'profiles' and column_name = 'friend_code') then
    insert into public.friend_codes (user_id, code)
      select id, lower(friend_code) from public.profiles
      where friend_code ~* '^[a-f0-9]{8}$'
    on conflict do nothing;
    alter table public.profiles alter column friend_code drop default;
    alter table public.profiles alter column friend_code drop not null;
    update public.profiles set friend_code = null where friend_code is not null;
  end if;
end $$;

-- Nieuwe, nog ongebruikte code van 8 tekens.
create or replace function public.new_friend_code()
returns text language plpgsql volatile security definer set search_path = public as $$
declare c text;
begin
  loop
    c := substr(md5(random()::text || clock_timestamp()::text), 1, 8);
    exit when not exists (select 1 from friend_codes where code = c);
  end loop;
  return c;
end;
$$;
revoke all on function public.new_friend_code() from public, anon, authenticated;

-- Je eigen code (wordt de eerste keer aangemaakt).
create or replace function public.my_friend_code()
returns text language plpgsql volatile security definer set search_path = public as $$
declare me uuid := auth.uid(); c text;
begin
  if me is null then raise exception 'Niet ingelogd'; end if;
  select fc.code into c from friend_codes fc where fc.user_id = me;
  if c is null then
    insert into friend_codes (user_id, code) values (me, public.new_friend_code())
    on conflict (user_id) do nothing;
    select fc.code into c from friend_codes fc where fc.user_id = me;
  end if;
  return c;
end;
$$;

-- Nieuwe code maken: de oude link en QR-code werken daarna niet meer.
create or replace function public.regenerate_friend_code()
returns text language plpgsql volatile security definer set search_path = public as $$
declare me uuid := auth.uid(); c text := public.new_friend_code();
begin
  if me is null then raise exception 'Niet ingelogd'; end if;
  insert into friend_codes (user_id, code) values (me, c)
  on conflict (user_id) do update set code = excluded.code, created_at = now();
  return c;
end;
$$;

-- Met iemands vriendcode (die hij zelf heeft gedeeld) ben je direct vrienden.
create or replace function public.request_friend_by_code(code text)
returns text language plpgsql security definer set search_path = public as $$
declare me uuid := auth.uid(); target uuid;
begin
  if me is null then raise exception 'Niet ingelogd'; end if;
  select fc.user_id into target from friend_codes fc where fc.code = lower(trim(request_friend_by_code.code));
  if target is null then raise exception 'Onbekende vriendcode'; end if;
  if target = me then return 'self'; end if;
  if public.is_friend(target) then return 'already'; end if;
  delete from friendships where (requester = me and addressee = target) or (requester = target and addressee = me);
  insert into friendships (requester, addressee, status, accepted_at) values (me, target, 'accepted', now());
  return 'accepted';
end;
$$;

-- Naam bij een vriendcode (voor de uitnodigingspagina).
create or replace function public.friend_code_preview(code text)
returns table (id uuid, display_name text)
language sql stable security definer set search_path = public as $$
  select p.id, p.display_name from friend_codes fc join profiles p on p.id = fc.user_id
  where fc.code = lower(trim(friend_code_preview.code));
$$;

-- Verzoek beantwoorden; geeft false als het verzoek intussen is ingetrokken.
drop function if exists public.respond_friend(uuid, boolean);
create function public.respond_friend(requester_id uuid, accept boolean)
returns boolean language plpgsql security definer set search_path = public as $$
declare n int;
begin
  if accept then
    update friendships set status = 'accepted', accepted_at = now()
    where requester = requester_id and addressee = auth.uid() and status = 'pending';
  else
    delete from friendships where requester = requester_id and addressee = auth.uid() and status = 'pending';
  end if;
  get diagnostics n = row_count;
  return n > 0;
end;
$$;

grant execute on function public.my_friend_code() to authenticated;
grant execute on function public.regenerate_friend_code() to authenticated;
grant execute on function public.request_friend_by_code(text) to authenticated;
grant execute on function public.friend_code_preview(text) to authenticated;
grant execute on function public.respond_friend(uuid, boolean) to authenticated;

-- ─────────────── Account verwijderen ───────────────
-- Groepen waar je in zit gaan over naar een ander lid (een trainer als die er is) en blijven dus
-- bestaan voor de rest; ben je de laatste trainer, dan wordt het langst zittende lid trainer. Een
-- groep zonder andere leden wordt verwijderd. Daarna verdwijnen je account en al je eigen gegevens
-- (sets, voeding, vriendschappen, meldingen) via "on delete cascade".
create or replace function public.delete_my_account()
returns void language plpgsql security definer set search_path = public, auth as $$
declare me uuid := auth.uid(); g record; heir uuid;
begin
  if me is null then raise exception 'Niet ingelogd'; end if;

  for g in select gm.group_id from group_members gm where gm.user_id = me loop
    heir := null;
    select gm.user_id into heir from group_members gm
      where gm.group_id = g.group_id and gm.user_id <> me
      order by (gm.role = 'trainer') desc, gm.joined_at
      limit 1;
    if heir is null then
      delete from groups where id = g.group_id;
    else
      if not exists (select 1 from group_members where group_id = g.group_id and user_id <> me and role = 'trainer') then
        update group_members set role = 'trainer' where group_id = g.group_id and user_id = heir;
      end if;
      update groups set created_by = heir where id = g.group_id and created_by = me;
      update workouts set created_by = heir where group_id = g.group_id and created_by = me;
    end if;
  end loop;

  -- Groepen die je maakte maar waar je zelf geen lid meer van was.
  for g in select gr.id from groups gr where gr.created_by = me loop
    heir := null;
    select gm.user_id into heir from group_members gm where gm.group_id = g.id
      order by (gm.role = 'trainer') desc, gm.joined_at limit 1;
    if heir is null then
      delete from groups where id = g.id;
    else
      update groups set created_by = heir where id = g.id;
      update workouts set created_by = heir where group_id = g.id and created_by = me;
    end if;
  end loop;

  -- Workouts die je maakte in groepen waar je geen lid meer van bent (en die je niet zelf maakte):
  -- overdragen aan een huidig lid, zodat de sets en opmerkingen van de anderen blijven bestaan.
  -- Alleen in een groep zonder leden verdwijnt de workout.
  for g in select distinct w.group_id from workouts w where w.created_by = me loop
    heir := null;
    select gm.user_id into heir from group_members gm
      where gm.group_id = g.group_id and gm.user_id <> me
      order by (gm.role = 'trainer') desc, gm.joined_at
      limit 1;
    if heir is null then
      delete from workouts where group_id = g.group_id and created_by = me;
    else
      update workouts set created_by = heir where group_id = g.group_id and created_by = me;
    end if;
  end loop;

  begin
    delete from auth.users where id = me;
  exception when insufficient_privilege then
    -- Geen rechten op auth.users: dan in elk geval al je gegevens wissen.
    delete from profiles where id = me;
  end;
end;
$$;
revoke all on function public.delete_my_account() from public, anon;
grant execute on function public.delete_my_account() to authenticated;
