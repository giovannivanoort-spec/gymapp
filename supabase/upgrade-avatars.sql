-- Profielfoto's: kolom profiles.avatar_url en een openbare opslagmap (bucket) "avatars".
-- Plak dit in Supabase -> SQL Editor -> New query -> Run (na schema.sql). Veilig om opnieuw te draaien.
-- Draai dit VOORDAT je de nieuwe versie van de app live zet: de app vraagt avatar_url op bij
-- vrienden, groepen en het eigen profiel. Zonder dit script meldt het profiel
-- "Profielfoto's zijn nog niet ingeschakeld".
--
-- Hoe het werkt:
-- - De app verkleint een foto op het toestel tot 320x320 (WebP of JPEG) en zet hem in
--   avatars/<jouw-id>/<tijdstip>.webp. Daarna komt de openbare URL in profiles.avatar_url.
-- - Iedereen mag de foto's lezen (openbare bucket, zodat <img> ze zonder inloggen kan laden);
--   alleen jijzelf mag bestanden in je eigen map toevoegen, vervangen of verwijderen.

-- ─────────── Kolom in profiles ───────────
alter table public.profiles add column if not exists avatar_url text;

-- Alleen een adres naar je eigen map in de bucket "avatars" van een Supabase-project
-- (https://<project>.supabase.co/storage/v1/object/public/avatars/<jouw-id>/<bestand>), van begin
-- tot eind gecontroleerd. Zo kan niemand een link naar een andere site invullen, die dan bij al
-- zijn vrienden en groepsgenoten geladen zou worden.
-- Gebruik je een eigen domein voor Supabase? Vervang dan [a-z0-9-]+\.supabase\.co hieronder
-- door je eigen domein (met een \ voor elke punt), op beide plekken.
-- Eerst oude waarden die niet aan deze regel voldoen leegmaken (anders faalt de nieuwe check).
update public.profiles
  set avatar_url = null
  where avatar_url is not null
    and not (
      length(avatar_url) < 1024
      and avatar_url ~ ('^https://[a-z0-9-]+\.supabase\.co/storage/v1/object/public/avatars/' || id::text || '/[A-Za-z0-9._-]+$')
    );

alter table public.profiles drop constraint if exists profiles_avatar_url_check;
alter table public.profiles add constraint profiles_avatar_url_check
  check (
    avatar_url is null
    or (
      length(avatar_url) < 1024
      and avatar_url ~ ('^https://[a-z0-9-]+\.supabase\.co/storage/v1/object/public/avatars/' || id::text || '/[A-Za-z0-9._-]+$')
    )
  );

-- Heb je STAP 2 uit upgrade-platform.sql al gedraaid (lezen per kolom)? Dan moet avatar_url er
-- ook bij. Zonder STAP 2 verandert dit niets (de hele tabel is dan al leesbaar).
grant select (avatar_url) on public.profiles to authenticated;

-- ─────────── Opslag: bucket "avatars" ───────────
-- Openbaar, maximaal 2 MB per bestand, alleen JPEG, PNG en WebP.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('avatars', 'avatars', true, 2097152, array['image/jpeg', 'image/png', 'image/webp'])
on conflict (id) do update
  set public = true,
      file_size_limit = 2097152,
      allowed_mime_types = array['image/jpeg', 'image/png', 'image/webp'];

-- Alleen in je eigen map (eerste mapnaam = jouw gebruikers-id). Lezen gaat via de openbare
-- URL; een select-policy is nodig om je eigen oude foto's op te sommen en op te ruimen.
drop policy if exists "avatars read own" on storage.objects;
create policy "avatars read own" on storage.objects for select to authenticated
  using (bucket_id = 'avatars' and (storage.foldername(name))[1] = auth.uid()::text);

drop policy if exists "avatars insert own" on storage.objects;
create policy "avatars insert own" on storage.objects for insert to authenticated
  with check (bucket_id = 'avatars' and (storage.foldername(name))[1] = auth.uid()::text);

drop policy if exists "avatars update own" on storage.objects;
create policy "avatars update own" on storage.objects for update to authenticated
  using (bucket_id = 'avatars' and (storage.foldername(name))[1] = auth.uid()::text)
  with check (bucket_id = 'avatars' and (storage.foldername(name))[1] = auth.uid()::text);

drop policy if exists "avatars delete own" on storage.objects;
create policy "avatars delete own" on storage.objects for delete to authenticated
  using (bucket_id = 'avatars' and (storage.foldername(name))[1] = auth.uid()::text);
