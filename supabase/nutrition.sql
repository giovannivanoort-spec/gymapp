-- Voeding: doelen, dagboek, eigen producten, opgeslagen maaltijden, AI-gebruik.
-- Plak dit in Supabase → SQL Editor → New query → Run. Veilig om opnieuw te draaien.

-- ─────────────── Doelen in het profiel ───────────────
alter table public.profiles add column if not exists activity_level text not null default 'moderate'
  check (activity_level in ('sedentary', 'light', 'moderate', 'active', 'very_active'));
alter table public.profiles add column if not exists nutrition_goal text not null default 'maintain'
  check (nutrition_goal in ('cut', 'maintain', 'bulk'));
-- Handmatige doelen (null = automatisch berekend).
alter table public.profiles add column if not exists kcal_target int check (kcal_target is null or kcal_target between 800 and 8000);
alter table public.profiles add column if not exists protein_target int check (protein_target is null or protein_target between 0 and 600);
alter table public.profiles add column if not exists carbs_target int check (carbs_target is null or carbs_target between 0 and 1500);
alter table public.profiles add column if not exists fat_target int check (fat_target is null or fat_target between 0 and 500);

-- ─────────────── Dagboek ───────────────
create table if not exists public.food_logs (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references public.profiles (id) on delete cascade,
  date date not null default current_date,
  meal text not null check (meal in ('breakfast', 'lunch', 'dinner', 'snack')),
  food_id text not null,
  source text not null check (source in ('basis', 'off', 'custom', 'recipe', 'ai')),
  name text not null,
  brand text,
  grams numeric(7, 1) not null check (grams > 0 and grams <= 10000),
  portion_label text,
  -- Waarden per 100 g op het moment van loggen (zodat het dagboek klopt als een product later verandert).
  per100 jsonb not null,
  kcal numeric(7, 1) not null,
  protein numeric(6, 1) not null,
  carbs numeric(6, 1) not null,
  fat numeric(6, 1) not null,
  created_at timestamptz not null default now()
);
create index if not exists food_logs_user_date on public.food_logs (user_id, date);

-- ─────────────── Eigen producten ───────────────
create table if not exists public.custom_foods (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references public.profiles (id) on delete cascade,
  name text not null,
  brand text,
  barcode text,
  per100 jsonb not null,
  portions jsonb not null default '[]'::jsonb,
  created_at timestamptz not null default now()
);
create index if not exists custom_foods_user on public.custom_foods (user_id);

-- ─────────────── Favorieten ───────────────
create table if not exists public.food_favorites (
  user_id uuid not null default auth.uid() references public.profiles (id) on delete cascade,
  food_id text not null,
  food jsonb not null,
  created_at timestamptz not null default now(),
  primary key (user_id, food_id)
);

-- ─────────────── Opgeslagen maaltijden (bijv. "mijn vaste ontbijt") ───────────────
-- items = [{ "food": Food, "grams": 60, "portion_label": "..." }]
create table if not exists public.saved_meals (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references public.profiles (id) on delete cascade,
  name text not null,
  items jsonb not null,
  created_at timestamptz not null default now()
);

-- ─────────────── AI-gebruik (voor de daglimiet van foto-schattingen) ───────────────
create table if not exists public.ai_usage (
  id bigint generated always as identity primary key,
  user_id uuid not null default auth.uid() references public.profiles (id) on delete cascade,
  kind text not null,
  created_at timestamptz not null default now()
);
create index if not exists ai_usage_user on public.ai_usage (user_id, kind, created_at);

alter table public.food_logs enable row level security;
alter table public.custom_foods enable row level security;
alter table public.food_favorites enable row level security;
alter table public.saved_meals enable row level security;
alter table public.ai_usage enable row level security;

drop policy if exists "food_logs own" on public.food_logs;
create policy "food_logs own" on public.food_logs for all to authenticated
  using (user_id = auth.uid()) with check (user_id = auth.uid());
drop policy if exists "custom_foods own" on public.custom_foods;
create policy "custom_foods own" on public.custom_foods for all to authenticated
  using (user_id = auth.uid()) with check (user_id = auth.uid());
drop policy if exists "food_favorites own" on public.food_favorites;
create policy "food_favorites own" on public.food_favorites for all to authenticated
  using (user_id = auth.uid()) with check (user_id = auth.uid());
drop policy if exists "saved_meals own" on public.saved_meals;
create policy "saved_meals own" on public.saved_meals for all to authenticated
  using (user_id = auth.uid()) with check (user_id = auth.uid());
drop policy if exists "ai_usage own" on public.ai_usage;
create policy "ai_usage own" on public.ai_usage for all to authenticated
  using (user_id = auth.uid()) with check (user_id = auth.uid());
