  verc-- AI-coach: gesprekken en berichten.
-- Plak dit in Supabase → SQL Editor → New query → Run (na schema.sql). Veilig om opnieuw te draaien.

create table if not exists public.coach_conversations (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references public.profiles (id) on delete cascade,
  title text not null default 'Nieuw gesprek',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists coach_conversations_user on public.coach_conversations (user_id, updated_at desc);

-- Elk bericht zoals het naar/van de Claude API gaat (content = content blocks als JSON).
-- kind: 'text' = vraag van de gebruiker, 'assistant' = antwoord van de coach,
--       'tool_results' = uitkomsten van tools (niet zichtbaar in de chat).
create table if not exists public.coach_messages (
  seq bigint generated always as identity primary key,
  conversation_id uuid not null references public.coach_conversations (id) on delete cascade,
  role text not null check (role in ('user', 'assistant')),
  kind text not null check (kind in ('text', 'assistant', 'tool_results')),
  content jsonb not null,
  created_at timestamptz not null default now()
);
create index if not exists coach_messages_conversation on public.coach_messages (conversation_id, seq);

alter table public.coach_conversations enable row level security;
alter table public.coach_messages enable row level security;

drop policy if exists "coach conversations own" on public.coach_conversations;
create policy "coach conversations own" on public.coach_conversations for all to authenticated
  using (user_id = auth.uid()) with check (user_id = auth.uid());

drop policy if exists "coach messages own" on public.coach_messages;
create policy "coach messages own" on public.coach_messages for all to authenticated
  using (exists (select 1 from public.coach_conversations c where c.id = conversation_id and c.user_id = auth.uid()))
  with check (exists (select 1 from public.coach_conversations c where c.id = conversation_id and c.user_id = auth.uid()));
