-- Profiel: lengte en geboortedatum (leeftijd wordt daaruit berekend en gebruikt voor de ranks).
-- Plak dit in Supabase → SQL Editor → New query → Run. Veilig om opnieuw te draaien.

alter table public.profiles add column if not exists height_cm numeric(4, 1)
  check (height_cm is null or height_cm between 100 and 250);
alter table public.profiles add column if not exists birth_date date
  check (birth_date is null or birth_date between '1900-01-01' and '2100-01-01');
