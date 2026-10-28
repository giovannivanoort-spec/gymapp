-- Ranks: lichaamsgewicht en geslacht in het profiel (nodig om krachtstandaarden te vergelijken).
-- Plak dit in Supabase → SQL Editor → New query → Run. Veilig om opnieuw te draaien.

alter table public.profiles add column if not exists bodyweight_kg numeric(5, 1)
  check (bodyweight_kg is null or bodyweight_kg between 30 and 300);
alter table public.profiles add column if not exists sex text
  check (sex is null or sex in ('male', 'female'));
