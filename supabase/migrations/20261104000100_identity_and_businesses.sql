-- SellPilot schema setup: part 1 of 4
-- Run in order. Each part is a separate transaction.
begin;
begin;

create schema if not exists private;
revoke all on schema private from public, anon;
grant usage on schema private to authenticated;

-- ---------------------------------------------------------------------------
-- Core identity and workspace tables
-- ---------------------------------------------------------------------------

create table public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  full_name text,
  phone_number text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.businesses (
  id uuid primary key default gen_random_uuid(),
  owner_user_id uuid not null references auth.users(id) on delete restrict,
  name text not null check (length(trim(name)) between 1 and 120),
  currency_code text not null default 'NGN'
    check (currency_code ~ '^[A-Z]{3}$'),
  timezone text not null default 'Africa/Lagos',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (id, owner_user_id)
);

create table public.business_members (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references public.businesses(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  role text not null check (role in ('owner', 'admin', 'staff')),
  created_at timestamptz not null default now(),
  unique (business_id, user_id)
);

create index business_members_user_idx on public.business_members(user_id);
create index business_members_business_idx on public.business_members(business_id);

-- These helpers are in the non-exposed private schema to avoid RLS recursion.
create or replace function private.has_business_access(_business_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select
    exists (
      select 1
      from public.businesses b
      where b.id = _business_id
        and b.owner_user_id = (select auth.uid())
    )
    or exists (
      select 1
      from public.business_members bm
      where bm.business_id = _business_id
        and bm.user_id = (select auth.uid())
    );
$$;

create or replace function private.has_business_role(
  _business_id uuid,
  _allowed_roles text[]
)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select
    exists (
      select 1
      from public.businesses b
      where b.id = _business_id
        and b.owner_user_id = (select auth.uid())
    )
    or exists (
      select 1
      from public.business_members bm
      where bm.business_id = _business_id
        and bm.user_id = (select auth.uid())
        and bm.role = any(_allowed_roles)
    );
$$;

revoke all on function private.has_business_access(uuid) from public, anon;
revoke all on function private.has_business_role(uuid, text[]) from public, anon;
grant execute on function private.has_business_access(uuid) to authenticated;
grant execute on function private.has_business_role(uuid, text[]) to authenticated;

create or replace function private.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.profiles (id, full_name)
  values (
    new.id,
    nullif(trim(new.raw_user_meta_data ->> 'full_name'), '')
  )
  on conflict (id) do nothing;

  return new;
end;
$$;

revoke all on function private.handle_new_user() from public, anon, authenticated;

create trigger on_auth_user_created
after insert on auth.users
for each row execute function private.handle_new_user();

-- Backfill profiles for accounts that existed before this migration.
insert into public.profiles (id, full_name)
select id, nullif(trim(raw_user_meta_data ->> 'full_name'), '')
from auth.users
on conflict (id) do nothing;

create or replace function private.add_business_owner_membership()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.business_members (business_id, user_id, role)
  values (new.id, new.owner_user_id, 'owner')
  on conflict (business_id, user_id) do nothing;

  return new;
end;
$$;

revoke all on function private.add_business_owner_membership() from public, anon, authenticated;

create trigger on_business_created_add_owner
after insert on public.businesses
for each row execute function private.add_business_owner_membership();

-- ---------------------------------------------------------------------------
commit;
