-- Schema's delen met je groep ("Van je trainer").
-- Plak dit in Supabase -> SQL Editor -> New query -> Run (na schema.sql). Veilig om opnieuw te draaien.
-- Zonder dit script werkt de app gewoon; alleen de knop "Delen met groep" meldt dan dat het nog niet kan.
--
-- Regels:
-- - Je ziet je eigen schema's en de schema's die een trainer met een van jouw groepen deelt.
-- - Alleen een trainer van die groep kan een schema met de groep delen.
-- - Bewerken kan de eigenaar en elke trainer van de groep waarmee het gedeeld is.
-- - Verwijderen kan alleen de eigenaar. Leden kopieren een gedeeld schema naar hun eigen lijst.

alter table public.templates
  add column if not exists group_id uuid references public.groups (id) on delete set null;

create index if not exists templates_group_id_idx on public.templates (group_id) where group_id is not null;

alter table public.templates enable row level security;

-- De oude "alles alleen van jezelf"-regel vervangen door losse regels per actie.
drop policy if exists "templates own" on public.templates;

drop policy if exists "templates read" on public.templates;
create policy "templates read" on public.templates for select to authenticated
  using (
    owner_id = auth.uid()
    or (group_id is not null and public.is_member(group_id))
  );

drop policy if exists "templates insert" on public.templates;
create policy "templates insert" on public.templates for insert to authenticated
  with check (
    owner_id = auth.uid()
    and (group_id is null or public.is_trainer(group_id))
  );

drop policy if exists "templates update" on public.templates;
create policy "templates update" on public.templates for update to authenticated
  using (
    owner_id = auth.uid()
    or (group_id is not null and public.is_trainer(group_id))
  )
  with check (
    (owner_id = auth.uid() or (group_id is not null and public.is_trainer(group_id)))
    and (group_id is null or public.is_trainer(group_id))
  );

drop policy if exists "templates delete" on public.templates;
create policy "templates delete" on public.templates for delete to authenticated
  using (owner_id = auth.uid());

grant select, insert, update, delete on public.templates to authenticated;
