create table if not exists users (
  id text primary key,
  data jsonb not null,
  updated_at timestamptz default now()
);

create table if not exists tickets (
  id text primary key,
  data jsonb not null,
  updated_at timestamptz default now()
);

create table if not exists settings (
  id text primary key,
  data jsonb not null,
  updated_at timestamptz default now()
);

create table if not exists sessions (
  id text primary key,
  data jsonb not null,
  updated_at timestamptz default now()
);
