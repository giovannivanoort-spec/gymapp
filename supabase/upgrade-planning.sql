-- Schema's delen met je groep ("Van je trainer").
-- Plak dit in Supabase -> SQL Editor -> New query -> Run (na schema.sql). Veilig om opnieuw te draaien.
-- Zonder dit script werkt de app gewoon; alleen de knop "Delen met groep" meldt dan dat het nog niet kan.
--
-- Regels:
-- - Je ziet je eigen schema's en de schema's die een trainer met een van jouw groepen deelt.
-- - Alleen een trainer van die groep kan een schema met de groep delen.
-- - Bewerken kan de eigenaar en elke trainer van de groep waarmee het gedeeld is. De eigenaar
--   blijft altijd de eigenaar en kan altijd bewerken en het delen stoppen.
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
  -- De eigenaar mag altijd de inhoud aanpassen en het delen stoppen (ook als hij geen trainer
  -- van die groep meer is). Wie de eigenaar is en met welke groep gedeeld wordt, bewaakt de
  -- trigger hieronder.
  with check (
    owner_id = auth.uid()
    or (group_id is not null and public.is_trainer(group_id))
  );

-- Eigenaar is niet over te nemen, en delen met een (andere) groep kan alleen als je daar trainer bent.
create or replace function public.templates_guard_update()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  -- Zonder ingelogde gebruiker (SQL Editor, service role): geen beperking.
  if auth.uid() is null then
    return new;
  end if;
  if new.owner_id is distinct from old.owner_id then
    raise exception 'De eigenaar van een schema kan niet worden gewijzigd.'
      using errcode = '42501';
  end if;
  if new.group_id is distinct from old.group_id
     and new.group_id is not null
     and not public.is_trainer(new.group_id) then
    raise exception 'Alleen een trainer van de groep kan een schema met de groep delen.'
      using errcode = '42501';
  end if;
  return new;
end;
$$;

drop trigger if exists templates_guard_update on public.templates;
create trigger templates_guard_update
  before update on public.templates
  for each row execute function public.templates_guard_update();

drop policy if exists "templates delete" on public.templates;
create policy "templates delete" on public.templates for delete to authenticated
  using (owner_id = auth.uid());

grant select, insert, update, delete on public.templates to authenticated;
