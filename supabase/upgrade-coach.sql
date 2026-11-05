-- AI-coach: daglimiet die niet te omzeilen is door gesprekken te verwijderen, en één antwoord
-- tegelijk per gesprek (ook met meerdere serverinstanties).
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

-- Gratis afmaken van een onderbroken antwoord: hoogstens een paar keer per vraag. Alleen toevoegen
-- en lezen, dus berichten wissen en opnieuw "afmaken" levert geen gratis antwoorden meer op.
create table if not exists public.coach_continuations (
  id bigint generated always as identity primary key,
  user_id uuid not null default auth.uid() references public.profiles (id) on delete cascade,
  nonce text not null,
  created_at timestamptz not null default now()
);
create index if not exists coach_continuations_user_nonce on public.coach_continuations (user_id, nonce);

alter table public.coach_continuations enable row level security;

drop policy if exists "coach continuations read own" on public.coach_continuations;
create policy "coach continuations read own" on public.coach_continuations for select to authenticated
  using (user_id = auth.uid());

drop policy if exists "coach continuations insert own" on public.coach_continuations;
create policy "coach continuations insert own" on public.coach_continuations for insert to authenticated
  with check (user_id = auth.uid());

revoke update, delete on public.coach_continuations from authenticated, anon;
grant select, insert on public.coach_continuations to authenticated;

-- Boekt één keer gratis afmaken voor de vraag met dit nonce. false = al p_max keer gedaan.
create or replace function public.coach_take_continuation(p_nonce text, p_max integer)
returns boolean
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
  perform pg_advisory_xact_lock(hashtext('coach_continue:' || uid::text || ':' || p_nonce));
  select count(*) into used from public.coach_continuations where user_id = uid and nonce = p_nonce;
  if used >= p_max then
    return false;
  end if;
  insert into public.coach_continuations (user_id, nonce) values (uid, p_nonce);
  return true;
end;
$$;

revoke all on function public.coach_take_continuation(text, integer) from public, anon;
grant execute on function public.coach_take_continuation(text, integer) to authenticated;

-- Eén antwoord tegelijk per gesprek, ook over meerdere serverinstanties heen (Vercel):
-- answer_run = welk verzoek het antwoord maakt, answer_until = tot wanneer (verlengd met een
-- hartslag), answer_stop = Stop gedrukt (het lopende antwoord ziet dat bij de volgende hartslag).
alter table public.coach_conversations add column if not exists answer_run uuid;
alter table public.coach_conversations add column if not exists answer_until timestamptz;
alter table public.coach_conversations add column if not exists answer_stop boolean not null default false;

-- Nieuwe kolommen en functies direct zichtbaar maken voor de API.
notify pgrst, 'reload schema';
