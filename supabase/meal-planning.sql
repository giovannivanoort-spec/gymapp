-- Voeding vooruit plannen: eten voor een latere dag staat als "gepland" en telt pas mee
-- zodra je op die dag bevestigt dat je het echt hebt gegeten.
-- Plak dit in Supabase → SQL Editor → New query → Run. Veilig om opnieuw te draaien.
alter table public.food_logs add column if not exists planned boolean not null default false;
