create table public.days (
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  date date not null,
  sleep numeric(4,1) check (sleep between 0 and 16),
  sleep_q smallint check (sleep_q between 1 and 5),
  hrv integer check (hrv between 5 and 250),
  rhr integer check (rhr between 25 and 120),
  steps integer check (steps >= 0),
  weight numeric(5,1) check (weight between 50 and 700),
  energy smallint check (energy between 1 and 5),
  workouts jsonb not null default '[]'::jsonb,
  meals jsonb not null default '[]'::jsonb,
  notes text check (char_length(notes) <= 2000),
  updated_at timestamptz not null default now(),
  primary key (user_id, date)
);

alter table public.days enable row level security;

create policy "Read own days" on public.days for select to authenticated using ((select auth.uid()) = user_id);
create policy "Insert own days" on public.days for insert to authenticated with check ((select auth.uid()) = user_id);
create policy "Update own days" on public.days for update to authenticated using ((select auth.uid()) = user_id) with check ((select auth.uid()) = user_id);
create policy "Delete own days" on public.days for delete to authenticated using ((select auth.uid()) = user_id);

revoke all on public.days from anon;
grant select, insert, update, delete on public.days to authenticated;
