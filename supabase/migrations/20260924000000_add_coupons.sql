create table if not exists public.coupons (
  id text primary key,
  data jsonb not null,
  updated_at timestamptz default now()
);
