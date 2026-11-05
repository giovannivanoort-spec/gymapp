-- Voeding: daglimiet voor foto-schattingen dichtzetten.
-- Voorheen mocht je je eigen ai_usage-regels ook wijzigen of verwijderen (policy "for all"),
-- waardoor je de daglimiet kon omzeilen. Nu alleen lezen en toevoegen.
-- Plak dit in Supabase → SQL Editor → New query → Run. Veilig om opnieuw te draaien.

drop policy if exists "ai_usage own" on public.ai_usage;
drop policy if exists "ai_usage select own" on public.ai_usage;
drop policy if exists "ai_usage insert own" on public.ai_usage;

create policy "ai_usage select own" on public.ai_usage for select to authenticated
  using (user_id = auth.uid());
create policy "ai_usage insert own" on public.ai_usage for insert to authenticated
  with check (user_id = auth.uid());

revoke update, delete on public.ai_usage from authenticated, anon;
