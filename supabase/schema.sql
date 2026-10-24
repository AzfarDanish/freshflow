-- Legacy single-demo state is retained for a non-destructive transition.
-- The service-role credential must stay on the Next.js server.
create table if not exists public.freshflow_state (
  id text primary key constraint freshflow_state_demo_id check (id = 'demo'),
  state jsonb not null check (jsonb_typeof(state) = 'object'),
  updated_at timestamptz not null default now()
);

alter table public.freshflow_state enable row level security;
revoke all on table public.freshflow_state from anon, authenticated;
grant all on table public.freshflow_state to service_role;

-- Keep the legacy table intact. Each simulated shop receives its own state row.
create table if not exists public.freshflow_business_state (
  business_id text primary key check (length(trim(business_id)) between 1 and 100),
  state jsonb not null check (jsonb_typeof(state) = 'object'),
  updated_at timestamptz not null default now()
);

alter table public.freshflow_business_state enable row level security;
revoke all on table public.freshflow_business_state from anon, authenticated;
grant all on table public.freshflow_business_state to service_role;

-- One-time, repeatable copy of the old demo row. Existing destination data wins.
insert into public.freshflow_business_state (business_id, state, updated_at)
select 'freshflow-demo', state, updated_at
from public.freshflow_state
where id = 'demo'
on conflict (business_id) do nothing;
