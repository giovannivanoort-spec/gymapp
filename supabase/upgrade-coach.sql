-- AI-coach: daglimiet die niet te omzeilen is door gesprekken te verwijderen.
-- Plak dit in Supabase -> SQL Editor -> New query -> Run (na coach.sql). Veilig om opnieuw te draaien.
-- Zonder dit script werkt de coach gewoon; de daglimiet telt dan de vragen in coach_messages.

-- Eén rij per gestelde vraag. Alleen toevoegen en lezen: geen update- of delete-policy,
-- dus verwijderen van gesprekken zet de teller niet terug.
create table if not exists public.coach_usage (
  id bigint generated always as identity primary key,
  user_id uuid not null default auth.uid() references public.profiles (id) on delete cascade,
  created_at timestamptz not null default now()
);
create index if not exists coach_usage_user_time on public.coach_usage (user_id, created_at desc);

alter table public.coach_usage enable row level security;

drop policy if exists "coach usage read own" on public.coach_usage;
create policy "coach usage read own" on public.coach_usage for select to authenticated
  using (user_id = auth.uid());

drop policy if exists "coach usage insert own" on public.coach_usage;
create policy "coach usage insert own" on public.coach_usage for insert to authenticated
  with check (user_id = auth.uid());

revoke update, delete on public.coach_usage from authenticated, anon;
grant select, insert on public.coach_usage to authenticated;

-- Controleert de limiet en boekt de vraag in één keer (met een slot per gebruiker, zodat twee
-- gelijktijdige verzoeken niet allebei door de controle glippen).
-- Geeft het aantal vragen sinds p_since terug ná het boeken, of -1 als de limiet al bereikt was.
create or replace function public.coach_take_question(p_since timestamptz, p_limit integer)
returns integer
language plpgsql
security invoker
set search_path = public
as $$
declare
  uid uuid := auth.uid();
  used integer;
begin
  if uid is null then
    raise exception 'not authenticated' using errcode = '42501';
  end if;
  perform pg_advisory_xact_lock(hashtext('coach_usage:' || uid::text));
  select count(*) into used from public.coach_usage where user_id = uid and created_at >= p_since;
  if used >= p_limit then
    return -1;
  end if;
  insert into public.coach_usage (user_id) values (uid);
  return used + 1;
end;
$$;

revoke all on function public.coach_take_question(timestamptz, integer) from public, anon;
grant execute on function public.coach_take_question(timestamptz, integer) to authenticated;
