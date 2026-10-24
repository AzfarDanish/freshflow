-- FreshFlow stores one synthetic demo workspace as JSONB.
-- The service-role credential must stay on the Next.js server.
create table if not exists public.freshflow_state (
  id text primary key constraint freshflow_state_demo_id check (id = 'demo'),
  state jsonb not null check (jsonb_typeof(state) = 'object'),
  updated_at timestamptz not null default now()
);

alter table public.freshflow_state enable row level security;
revoke all on table public.freshflow_state from anon, authenticated;
grant all on table public.freshflow_state to service_role;
