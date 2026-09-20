-- Créer un projet gratuit sur https://supabase.com
-- SQL Editor → coller ce script → Run

create table if not exists public.missions (
  id uuid primary key default gen_random_uuid(),
  title text not null,
  author text not null default 'anonyme',
  payload jsonb not null,
  created_at timestamptz not null default now()
);

create index if not exists missions_created_at_idx
  on public.missions (created_at desc);

alter table public.missions enable row level security;

-- Lecture publique (tous les utilisateurs de l'app)
create policy "missions_select_public"
  on public.missions for select
  to anon, authenticated
  using (true);

-- Écriture publique (sauvegardes partagées)
create policy "missions_insert_public"
  on public.missions for insert
  to anon, authenticated
  with check (true);

-- Suppression publique (à durcir plus tard avec auth)
create policy "missions_delete_public"
  on public.missions for delete
  to anon, authenticated
  using (true);
