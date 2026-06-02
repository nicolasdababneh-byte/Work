create table if not exists public.bet_tracker_profiles (
  user_id uuid primary key references auth.users(id) on delete cascade,
  bets jsonb not null default '[]'::jsonb,
  settings jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now()
);

alter table public.bet_tracker_profiles enable row level security;

drop policy if exists "Users can read their tracker profile" on public.bet_tracker_profiles;
create policy "Users can read their tracker profile"
  on public.bet_tracker_profiles
  for select
  using (auth.uid() = user_id);

drop policy if exists "Users can insert their tracker profile" on public.bet_tracker_profiles;
create policy "Users can insert their tracker profile"
  on public.bet_tracker_profiles
  for insert
  with check (auth.uid() = user_id);

drop policy if exists "Users can update their tracker profile" on public.bet_tracker_profiles;
create policy "Users can update their tracker profile"
  on public.bet_tracker_profiles
  for update
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

create or replace function public.set_tracker_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists set_tracker_updated_at on public.bet_tracker_profiles;
create trigger set_tracker_updated_at
  before update on public.bet_tracker_profiles
  for each row
  execute function public.set_tracker_updated_at();
