-- MEAL. Run once in your Supabase project (SQL Editor). Safe to share a project with other apps.
begin;

-- Everything you ate, one row per item.
create table public.meal_entries (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid(),
  eaten_on date not null,
  slot text not null default 'snack' check (slot in ('breakfast','lunch','dinner','snack')),
  name text not null,
  brand text not null default '',
  portion text not null default '',
  calories numeric not null default 0 check (calories >= 0),
  protein numeric not null default 0 check (protein >= 0),
  carbs numeric not null default 0 check (carbs >= 0),
  fat numeric not null default 0 check (fat >= 0),
  source text not null default 'manual' check (source in ('manual','barcode','photo','saved')),
  barcode text not null default '',
  created_at timestamptz not null default now()
);

-- Foods you want to log again quickly, including anything scanned.
create table public.foods (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid(),
  name text not null,
  brand text not null default '',
  barcode text not null default '',
  serving text not null default '1 serving',
  calories numeric not null default 0 check (calories >= 0),
  protein numeric not null default 0 check (protein >= 0),
  carbs numeric not null default 0 check (carbs >= 0),
  fat numeric not null default 0 check (fat >= 0),
  created_at timestamptz not null default now()
);

-- One row per person: your daily targets.
create table public.meal_goals (
  user_id uuid primary key default auth.uid(),
  calories numeric not null default 2000 check (calories > 0),
  protein numeric not null default 150 check (protein >= 0),
  carbs numeric not null default 200 check (carbs >= 0),
  fat numeric not null default 65 check (fat >= 0),
  updated_at timestamptz not null default now()
);

create index meal_entries_by_day on public.meal_entries (user_id, eaten_on desc);
create index foods_by_user on public.foods (user_id, name);
create unique index foods_barcode_once on public.foods (user_id, barcode) where barcode <> '';

alter table public.meal_entries enable row level security;
alter table public.foods enable row level security;
alter table public.meal_goals enable row level security;

create policy me_read   on public.meal_entries for select using (user_id = auth.uid());
create policy me_write  on public.meal_entries for insert with check (user_id = auth.uid());
create policy me_edit   on public.meal_entries for update using (user_id = auth.uid()) with check (user_id = auth.uid());
create policy me_remove on public.meal_entries for delete using (user_id = auth.uid());

create policy f_read   on public.foods for select using (user_id = auth.uid());
create policy f_write  on public.foods for insert with check (user_id = auth.uid());
create policy f_edit   on public.foods for update using (user_id = auth.uid()) with check (user_id = auth.uid());
create policy f_remove on public.foods for delete using (user_id = auth.uid());

create policy g_read   on public.meal_goals for select using (user_id = auth.uid());
create policy g_write  on public.meal_goals for insert with check (user_id = auth.uid());
create policy g_edit   on public.meal_goals for update using (user_id = auth.uid()) with check (user_id = auth.uid());

grant usage on schema public to authenticated;
grant select, insert, update, delete on public.meal_entries to authenticated;
grant select, insert, update, delete on public.foods to authenticated;
grant select, insert, update on public.meal_goals to authenticated;

commit;
