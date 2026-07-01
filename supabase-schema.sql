create table if not exists public.users (
  id text primary key,
  data jsonb not null,
  updated_at timestamptz default now()
);

create table if not exists public.tickets (
  id text primary key,
  data jsonb not null,
  updated_at timestamptz default now()
);

create table if not exists public.settings (
  id text primary key,
  data jsonb not null,
  updated_at timestamptz default now()
);

create table if not exists public.sessions (
  id text primary key,
  data jsonb not null,
  updated_at timestamptz default now()
);
