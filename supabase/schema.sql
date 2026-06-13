create extension if not exists pgcrypto;

create table if not exists public.event_clients (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  token_hash text not null unique,
  active boolean not null default true,
  created_at timestamptz not null default now()
);

create table if not exists public.events (
  id uuid primary key default gen_random_uuid(),
  client_id uuid references public.event_clients(id) on delete set null,
  client_name text not null,
  title text not null,
  slug text not null unique,
  event_date date not null,
  event_time time,
  city text,
  external_link text,
  image_url_1 text,
  image_url_2 text,
  categories text[] not null default '{}',
  description text,
  published boolean not null default true,
  created_at timestamptz not null default now()
);

create index if not exists events_public_date_idx
  on public.events (published, event_date, event_time);

create index if not exists events_slug_idx
  on public.events (slug);

alter table public.event_clients enable row level security;
alter table public.events enable row level security;

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'event-images',
  'event-images',
  true,
  8388608,
  array['image/jpeg', 'image/png', 'image/webp']
)
on conflict (id) do update set
  public = excluded.public,
  file_size_limit = excluded.file_size_limit,
  allowed_mime_types = excluded.allowed_mime_types;

-- O app usa a SERVICE_ROLE_KEY no servidor, que ignora RLS.
-- Nao crie policies publicas agora; isso evita escrita/leitura direta pelo navegador.
