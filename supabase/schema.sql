-- BroLink: esquema reproducible para una instalación nueva de Supabase.
-- Ejecuta este archivo una sola vez desde Supabase > SQL Editor.
-- No contiene usuarios, mensajes, archivos ni claves privadas.

create extension if not exists pgcrypto;

create table if not exists public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  display_name text not null default '',
  avatar_url text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.items (
  id uuid primary key default gen_random_uuid(),
  sender_id uuid not null references auth.users(id) on delete cascade,
  recipient_id uuid references auth.users(id) on delete cascade,
  kind text not null check (kind in ('file', 'link', 'note')),
  title text not null,
  note text,
  url text,
  drime_file_id text,
  drime_hash text,
  file_size bigint check (file_size is null or file_size >= 0),
  mime_type text,
  status text not null default 'new' check (status in ('new', 'seen', 'downloaded')),
  created_at timestamptz not null default now(),
  seen_at timestamptz,
  downloaded_at timestamptz
);

create table if not exists public.item_user_state (
  user_id uuid not null references auth.users(id) on delete cascade,
  item_id uuid not null references public.items(id) on delete cascade,
  is_favorite boolean not null default false,
  trashed_at timestamptz,
  updated_at timestamptz not null default now(),
  primary key (user_id, item_id)
);

create index if not exists items_sender_id_idx on public.items(sender_id);
create index if not exists items_recipient_id_idx on public.items(recipient_id);
create index if not exists items_created_at_idx on public.items(created_at desc);
create index if not exists item_user_state_item_idx on public.item_user_state(item_id);
create index if not exists item_user_state_favorite_idx
  on public.item_user_state(user_id, is_favorite) where is_favorite = true;
create index if not exists item_user_state_trash_idx
  on public.item_user_state(user_id, trashed_at) where trashed_at is not null;

alter table public.profiles enable row level security;
alter table public.items enable row level security;
alter table public.item_user_state enable row level security;

revoke all on public.profiles, public.items, public.item_user_state from anon;
revoke all on public.profiles, public.items, public.item_user_state from authenticated;
grant select, update on public.profiles to authenticated;
grant select, insert, update, delete on public.items to authenticated;
grant select, insert, update, delete on public.item_user_state to authenticated;

drop policy if exists profiles_read_authenticated on public.profiles;
create policy profiles_read_authenticated
on public.profiles for select to authenticated
using (true);

drop policy if exists profiles_update_self on public.profiles;
create policy profiles_update_self
on public.profiles for update to authenticated
using ((select auth.uid()) = id)
with check ((select auth.uid()) = id);

drop policy if exists items_read_participants on public.items;
create policy items_read_participants
on public.items for select to authenticated
using ((select auth.uid()) = sender_id or (select auth.uid()) = recipient_id);

drop policy if exists items_insert_sender on public.items;
create policy items_insert_sender
on public.items for insert to authenticated
with check (
  (select auth.uid()) = sender_id
  and recipient_id is not null
  and recipient_id <> sender_id
);

drop policy if exists items_update_recipient on public.items;
create policy items_update_recipient
on public.items for update to authenticated
using ((select auth.uid()) = recipient_id)
with check ((select auth.uid()) = recipient_id and sender_id <> recipient_id);

drop policy if exists items_delete_sender on public.items;
create policy items_delete_sender
on public.items for delete to authenticated
using ((select auth.uid()) = sender_id);

drop policy if exists item_user_state_select_own on public.item_user_state;
create policy item_user_state_select_own
on public.item_user_state for select to authenticated
using ((select auth.uid()) = user_id);

drop policy if exists item_user_state_insert_own on public.item_user_state;
create policy item_user_state_insert_own
on public.item_user_state for insert to authenticated
with check ((select auth.uid()) = user_id);

drop policy if exists item_user_state_update_own on public.item_user_state;
create policy item_user_state_update_own
on public.item_user_state for update to authenticated
using ((select auth.uid()) = user_id)
with check ((select auth.uid()) = user_id);

drop policy if exists item_user_state_delete_own on public.item_user_state;
create policy item_user_state_delete_own
on public.item_user_state for delete to authenticated
using ((select auth.uid()) = user_id);

create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.profiles (id, display_name, avatar_url)
  values (
    new.id,
    coalesce(
      nullif(new.raw_user_meta_data ->> 'display_name', ''),
      nullif(new.raw_user_meta_data ->> 'full_name', ''),
      nullif(new.raw_user_meta_data ->> 'name', ''),
      split_part(coalesce(new.email, ''), '@', 1)
    ),
    coalesce(
      nullif(new.raw_user_meta_data ->> 'avatar_url', ''),
      nullif(new.raw_user_meta_data ->> 'picture', '')
    )
  )
  on conflict (id) do nothing;
  return new;
end;
$$;

revoke all on function public.handle_new_user() from public, anon, authenticated;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
after insert on auth.users
for each row execute function public.handle_new_user();

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'avatars',
  'avatars',
  false,
  2097152,
  array['image/png', 'image/jpeg', 'image/webp']
)
on conflict (id) do update set
  public = excluded.public,
  file_size_limit = excluded.file_size_limit,
  allowed_mime_types = excluded.allowed_mime_types;

drop policy if exists avatars_read_authenticated on storage.objects;
create policy avatars_read_authenticated
on storage.objects for select to authenticated
using (bucket_id = 'avatars');

drop policy if exists avatars_insert_own on storage.objects;
create policy avatars_insert_own
on storage.objects for insert to authenticated
with check (
  bucket_id = 'avatars'
  and (storage.foldername(name))[1] = (select auth.uid())::text
);

drop policy if exists avatars_update_own on storage.objects;
create policy avatars_update_own
on storage.objects for update to authenticated
using (
  bucket_id = 'avatars'
  and (storage.foldername(name))[1] = (select auth.uid())::text
)
with check (
  bucket_id = 'avatars'
  and (storage.foldername(name))[1] = (select auth.uid())::text
);

drop policy if exists avatars_delete_own on storage.objects;
create policy avatars_delete_own
on storage.objects for delete to authenticated
using (
  bucket_id = 'avatars'
  and (storage.foldername(name))[1] = (select auth.uid())::text
);

