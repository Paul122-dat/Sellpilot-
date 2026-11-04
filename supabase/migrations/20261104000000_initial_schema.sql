-- SellPilot initial database schema
-- Apply ONCE in the Supabase SQL Editor using the project owner role.
-- This migration creates tenant-scoped tables, access policies, append-only
-- payment/stock/expense ledgers, and read-only summaries.

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
-- Seller operations
-- ---------------------------------------------------------------------------

create table public.customers (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references public.businesses(id) on delete cascade,
  name text not null check (length(trim(name)) between 1 and 160),
  phone_number text,
  whatsapp_number text,
  email text,
  instagram_handle text,
  delivery_address text,
  notes text,
  created_by uuid references auth.users(id) on delete set null default auth.uid(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (id, business_id)
);

create index customers_business_name_idx
  on public.customers(business_id, name);
create index customers_business_created_idx
  on public.customers(business_id, created_at desc);

create table public.products (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references public.businesses(id) on delete cascade,
  sku text,
  name text not null check (length(trim(name)) between 1 and 160),
  description text,
  selling_price numeric(14,2) not null default 0 check (selling_price >= 0),
  cost_price numeric(14,2) check (cost_price is null or cost_price >= 0),
  track_inventory boolean not null default true,
  low_stock_threshold integer not null default 5 check (low_stock_threshold >= 0),
  is_archived boolean not null default false,
  created_by uuid references auth.users(id) on delete set null default auth.uid(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (id, business_id),
  check (sku is null or length(trim(sku)) > 0)
);

create unique index products_business_sku_unique
  on public.products (business_id, lower(sku))
  where sku is not null;
create index products_business_name_idx on public.products(business_id, name);

create table public.stock_movements (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references public.businesses(id) on delete cascade,
  product_id uuid not null,
  movement_type text not null
    check (movement_type in ('purchase', 'sale', 'return', 'adjustment')),
  quantity_change integer not null check (quantity_change <> 0),
  note text,
  reference text,
  created_by uuid references auth.users(id) on delete set null default auth.uid(),
  created_at timestamptz not null default now(),
  foreign key (product_id, business_id)
    references public.products(id, business_id) on delete restrict,
  check (
    (movement_type in ('purchase', 'return') and quantity_change > 0)
    or (movement_type = 'sale' and quantity_change < 0)
    or movement_type = 'adjustment'
  )
);

create index stock_movements_product_idx
  on public.stock_movements(business_id, product_id, created_at desc);

-- Stock is derived from the movement ledger; it is never edited directly.
create or replace function private.validate_stock_movement()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_tracks_inventory boolean;
  v_current_stock bigint;
begin
  if not private.has_business_access(new.business_id) then
    raise exception 'You do not have access to this business.';
  end if;

  select p.track_inventory
    into v_tracks_inventory
  from public.products p
  where p.id = new.product_id
    and p.business_id = new.business_id
  for update;

  if not found or v_tracks_inventory is not true then
    raise exception 'This product does not have tracked inventory.';
  end if;

  select coalesce(sum(sm.quantity_change), 0)
    into v_current_stock
  from public.stock_movements sm
  where sm.product_id = new.product_id
    and sm.business_id = new.business_id;

  if v_current_stock + new.quantity_change < 0 then
    raise exception 'This stock movement would make inventory negative.';
  end if;

  return new;
end;
$$;

revoke all on function private.validate_stock_movement() from public, anon, authenticated;

create trigger validate_stock_before_insert
before insert on public.stock_movements
for each row execute function private.validate_stock_movement();

create table public.orders (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references public.businesses(id) on delete cascade,
  order_number text,
  customer_id uuid references public.customers(id) on delete set null,
  customer_name text not null check (length(trim(customer_name)) between 1 and 160),
  customer_phone text,
  sales_channel text not null default 'other'
    check (sales_channel in ('whatsapp', 'instagram', 'in_person', 'other')),
  order_status text not null default 'pending'
    check (order_status in (
      'pending', 'confirmed', 'processing', 'ready',
      'dispatched', 'delivered', 'cancelled'
    )),
  currency_code text not null default 'NGN'
    check (currency_code ~ '^[A-Z]{3}$'),
  subtotal_amount numeric(14,2) not null default 0 check (subtotal_amount >= 0),
  discount_amount numeric(14,2) not null default 0 check (discount_amount >= 0),
  delivery_fee numeric(14,2) not null default 0 check (delivery_fee >= 0),
  total_amount numeric(14,2)
    generated always as (subtotal_amount - discount_amount + delivery_fee) stored,
  expected_delivery_date date,
  delivery_address text,
  notes text,
  created_by uuid references auth.users(id) on delete set null default auth.uid(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (id, business_id),
  check (discount_amount <= subtotal_amount),
  check (order_number is null or length(trim(order_number)) > 0)
);

create unique index orders_business_number_unique
  on public.orders(business_id, order_number)
  where order_number is not null;
create index orders_business_created_idx
  on public.orders(business_id, created_at desc);
create index orders_business_status_idx
  on public.orders(business_id, order_status);
create index orders_customer_idx on public.orders(customer_id);

create or replace function private.validate_order_customer()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.customer_id is not null and not exists (
    select 1
    from public.customers c
    where c.id = new.customer_id
      and c.business_id = new.business_id
  ) then
    raise exception 'The selected customer does not belong to this business.';
  end if;

  return new;
end;
$$;

revoke all on function private.validate_order_customer() from public, anon, authenticated;

create trigger validate_order_customer_before_write
before insert or update of customer_id, business_id on public.orders
for each row execute function private.validate_order_customer();

create table public.order_items (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references public.businesses(id) on delete cascade,
  order_id uuid not null,
  product_id uuid references public.products(id) on delete set null,
  product_name text not null check (length(trim(product_name)) between 1 and 160),
  quantity integer not null check (quantity > 0),
  unit_price numeric(14,2) not null check (unit_price >= 0),
  unit_cost numeric(14,2) check (unit_cost is null or unit_cost >= 0),
  line_total numeric(14,2)
    generated always as (quantity * unit_price) stored,
  created_at timestamptz not null default now(),
  foreign key (order_id, business_id)
    references public.orders(id, business_id) on delete cascade
);

create index order_items_order_idx on public.order_items(business_id, order_id);

create or replace function private.validate_order_item_product()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  v_product_name text;
  v_cost_price numeric(14,2);
begin
  if new.product_id is not null then
    select p.name, p.cost_price
      into v_product_name, v_cost_price
    from public.products p
    where p.id = new.product_id
      and p.business_id = new.business_id;

    if not found then
      raise exception 'The selected product does not belong to this business.';
    end if;

    if tg_op = 'INSERT' then
      new.product_name := v_product_name;
      if new.unit_cost is null then
        new.unit_cost := v_cost_price;
      end if;
    elsif new.product_id is distinct from old.product_id and new.unit_cost is null then
      new.product_name := v_product_name;
      new.unit_cost := v_cost_price;
    end if;
  end if;

  return new;
end;
$$;

revoke all on function private.validate_order_item_product() from public, anon, authenticated;

create trigger validate_order_item_product_before_write
before insert or update of product_id, business_id, unit_cost on public.order_items
for each row execute function private.validate_order_item_product();

-- Order subtotal is recalculated from item snapshots in the same transaction.
create or replace function private.recalculate_order_subtotal()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if tg_op in ('UPDATE', 'DELETE') then
    update public.orders o
       set subtotal_amount = (
         select coalesce(sum(oi.line_total), 0)
         from public.order_items oi
         where oi.order_id = old.order_id
           and oi.business_id = old.business_id
       )
     where o.id = old.order_id
       and o.business_id = old.business_id;
  end if;

  if tg_op in ('INSERT', 'UPDATE') then
    update public.orders o
       set subtotal_amount = (
         select coalesce(sum(oi.line_total), 0)
         from public.order_items oi
         where oi.order_id = new.order_id
           and oi.business_id = new.business_id
       )
     where o.id = new.order_id
       and o.business_id = new.business_id;
  end if;

  return null;
end;
$$;

revoke all on function private.recalculate_order_subtotal() from public, anon, authenticated;

create trigger recalculate_order_after_item_change
after insert or update or delete on public.order_items
for each row execute function private.recalculate_order_subtotal();

-- Prevent clients from supplying a made-up subtotal. It must equal the sum
-- of the saved order-item snapshots. The initial order header starts at zero.
create or replace function private.validate_order_totals()
returns trigger
language plpgsql
set search_path = ''
as $
declare
  v_items_subtotal numeric(14,2);
begin
  if tg_op = 'INSERT' then
    if new.subtotal_amount <> 0 then
      raise exception 'Order subtotal is calculated from order items.';
    end if;
  else
    if new.currency_code is distinct from old.currency_code then
      raise exception 'Order currency cannot be changed after creation.';
    end if;

    if new.subtotal_amount is distinct from old.subtotal_amount then
      select coalesce(sum(oi.line_total), 0)
        into v_items_subtotal
      from public.order_items oi
      where oi.order_id = new.id
        and oi.business_id = new.business_id;

      if new.subtotal_amount is distinct from v_items_subtotal then
        raise exception 'Order subtotal must equal the sum of its order items.';
      end if;
    end if;
  end if;

  return new;
end;
$;

revoke all on function private.validate_order_totals() from public, anon, authenticated;

create trigger validate_order_totals_before_write
before insert or update on public.orders
for each row execute function private.validate_order_totals();

create table public.payments (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references public.businesses(id) on delete cascade,
  order_id uuid not null,
  transaction_type text not null
    check (transaction_type in ('payment', 'refund')),
  amount numeric(14,2) not null check (amount > 0),
  payment_method text not null
    check (payment_method in ('cash', 'bank_transfer', 'card', 'online', 'other')),
  reference text,
  note text,
  recorded_by uuid references auth.users(id) on delete set null default auth.uid(),
  recorded_at timestamptz not null default now(),
  foreign key (order_id, business_id)
    references public.orders(id, business_id) on delete restrict
);

create index payments_order_idx
  on public.payments(business_id, order_id, recorded_at desc);
create unique index payments_reference_unique
  on public.payments(business_id, payment_method, reference)
  where reference is not null;

-- Refunds cannot exceed the amount actually recorded as received.
create or replace function private.validate_refund_entry()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_order_id uuid;
  v_received numeric(14,2);
  v_refunded numeric(14,2);
begin
  if not private.has_business_access(new.business_id) then
    raise exception 'You do not have access to this business.';
  end if;

  select o.id
    into v_order_id
  from public.orders o
  where o.id = new.order_id
    and o.business_id = new.business_id
  for update;

  if not found then
    raise exception 'The selected order was not found for this business.';
  end if;

  if new.transaction_type = 'refund' then
    select
      coalesce(sum(p.amount) filter (where p.transaction_type = 'payment'), 0),
      coalesce(sum(p.amount) filter (where p.transaction_type = 'refund'), 0)
    into v_received, v_refunded
    from public.payments p
    where p.order_id = new.order_id
      and p.business_id = new.business_id;

    if new.amount > v_received - v_refunded then
      raise exception 'A refund cannot exceed the amount received and not already refunded.';
    end if;
  end if;

  return new;
end;
$$;

revoke all on function private.validate_refund_entry() from public, anon, authenticated;

create trigger validate_payment_before_insert
before insert on public.payments
for each row execute function private.validate_refund_entry();

-- Expenses use an append-only ledger. Correct an entry with a reversal,
-- rather than silently changing or deleting financial history.
create table public.expenses (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references public.businesses(id) on delete cascade,
  entry_type text not null default 'expense'
    check (entry_type in ('expense', 'reversal')),
  reverses_expense_id uuid,
  category text not null check (length(trim(category)) between 1 and 80),
  description text,
  amount numeric(14,2) not null check (amount > 0),
  payment_method text
    check (payment_method is null or payment_method in (
      'cash', 'bank_transfer', 'card', 'online', 'other'
    )),
  incurred_on date not null default current_date,
  recorded_by uuid references auth.users(id) on delete set null default auth.uid(),
  recorded_at timestamptz not null default now(),
  unique (id, business_id),
  foreign key (reverses_expense_id, business_id)
    references public.expenses(id, business_id) on delete restrict,
  check (
    (entry_type = 'expense' and reverses_expense_id is null)
    or (entry_type = 'reversal' and reverses_expense_id is not null)
  )
);

create index expenses_business_date_idx
  on public.expenses(business_id, incurred_on desc);

create or replace function private.validate_expense_reversal()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_original_amount numeric(14,2);
  v_original_type text;
  v_reversed_so_far numeric(14,2);
begin
  if not private.has_business_access(new.business_id) then
    raise exception 'You do not have access to this business.';
  end if;

  if new.entry_type = 'reversal' then
    select e.amount, e.entry_type
      into v_original_amount, v_original_type
    from public.expenses e
    where e.id = new.reverses_expense_id
      and e.business_id = new.business_id
    for update;

    if not found or v_original_type <> 'expense' then
      raise exception 'A reversal must refer to an original expense in this business.';
    end if;

    select coalesce(sum(e.amount), 0)
      into v_reversed_so_far
    from public.expenses e
    where e.reverses_expense_id = new.reverses_expense_id
      and e.business_id = new.business_id;

    if v_reversed_so_far + new.amount > v_original_amount then
      raise exception 'Total reversals cannot exceed the original expense.';
    end if;
  end if;

  return new;
end;
$$;

revoke all on function private.validate_expense_reversal() from public, anon, authenticated;

create trigger validate_expense_before_insert
before insert on public.expenses
for each row execute function private.validate_expense_reversal();

-- ---------------------------------------------------------------------------
-- Views: read-only calculations, with underlying RLS applied to the caller.
-- ---------------------------------------------------------------------------

create view public.product_stock_levels
with (security_invoker = true)
as
select
  p.id as product_id,
  p.business_id,
  p.name,
  p.sku,
  p.track_inventory,
  p.low_stock_threshold,
  case
    when p.track_inventory then coalesce(sum(sm.quantity_change), 0)::bigint
    else null
  end as stock_on_hand,
  case
    when not p.track_inventory then 'not_tracked'
    when coalesce(sum(sm.quantity_change), 0) <= p.low_stock_threshold then 'low_stock'
    else 'in_stock'
  end as stock_status
from public.products p
left join public.stock_movements sm
  on sm.product_id = p.id
 and sm.business_id = p.business_id
group by p.id, p.business_id, p.name, p.sku, p.track_inventory, p.low_stock_threshold;

create view public.order_financial_summary
with (security_invoker = true)
as
with payment_totals as (
  select
    p.business_id,
    p.order_id,
    coalesce(sum(p.amount) filter (where p.transaction_type = 'payment'), 0) as amount_received,
    coalesce(sum(p.amount) filter (where p.transaction_type = 'refund'), 0) as amount_refunded
  from public.payments p
  group by p.business_id, p.order_id
)
select
  o.id as order_id,
  o.business_id,
  o.order_status,
  o.currency_code,
  o.subtotal_amount,
  o.discount_amount,
  o.delivery_fee,
  o.total_amount,
  coalesce(pt.amount_received, 0)::numeric(14,2) as amount_received,
  coalesce(pt.amount_refunded, 0)::numeric(14,2) as amount_refunded,
  (coalesce(pt.amount_received, 0) - coalesce(pt.amount_refunded, 0))::numeric(14,2)
    as net_amount_received,
  (
    o.total_amount - coalesce(pt.amount_received, 0) + coalesce(pt.amount_refunded, 0)
  )::numeric(14,2) as balance_due,
  case
    when o.total_amount = 0 then 'no_payment_required'
    when coalesce(pt.amount_received, 0) - coalesce(pt.amount_refunded, 0) = 0 then 'unpaid'
    when coalesce(pt.amount_received, 0) - coalesce(pt.amount_refunded, 0) < o.total_amount then 'partially_paid'
    when coalesce(pt.amount_received, 0) - coalesce(pt.amount_refunded, 0) = o.total_amount then 'paid'
    else 'overpaid'
  end as payment_status
from public.orders o
left join payment_totals pt
  on pt.order_id = o.id
 and pt.business_id = o.business_id;

create view public.order_cost_summary
with (security_invoker = true)
as
select
  oi.business_id,
  oi.order_id,
  coalesce(sum(oi.quantity * oi.unit_cost) filter (where oi.unit_cost is not null), 0)::numeric(14,2)
    as known_cost_of_goods,
  count(*) filter (where oi.unit_cost is null)::integer as uncosted_line_count,
  (count(*) filter (where oi.unit_cost is null) = 0) as cost_data_complete
from public.order_items oi
group by oi.business_id, oi.order_id;

create view public.business_expense_summary
with (security_invoker = true)
as
select
  e.business_id,
  coalesce(sum(case when e.entry_type = 'expense' then e.amount else -e.amount end), 0)::numeric(14,2)
    as net_expenses
from public.expenses e
group by e.business_id;

-- ---------------------------------------------------------------------------
-- Updated timestamps and tenant reassignment protection
-- ---------------------------------------------------------------------------

create or replace function private.set_updated_at()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

create or replace function private.prevent_business_reassignment()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.business_id is distinct from old.business_id then
    raise exception 'A record cannot be moved between businesses.';
  end if;
  return new;
end;
$$;

revoke all on function private.set_updated_at() from public, anon, authenticated;
revoke all on function private.prevent_business_reassignment() from public, anon, authenticated;

create trigger profiles_set_updated_at before update on public.profiles
for each row execute function private.set_updated_at();
create trigger businesses_set_updated_at before update on public.businesses
for each row execute function private.set_updated_at();
create trigger customers_set_updated_at before update on public.customers
for each row execute function private.set_updated_at();
create trigger products_set_updated_at before update on public.products
for each row execute function private.set_updated_at();
create trigger orders_set_updated_at before update on public.orders
for each row execute function private.set_updated_at();

create trigger members_prevent_business_reassignment before update on public.business_members
for each row execute function private.prevent_business_reassignment();
create trigger customers_prevent_business_reassignment before update on public.customers
for each row execute function private.prevent_business_reassignment();
create trigger products_prevent_business_reassignment before update on public.products
for each row execute function private.prevent_business_reassignment();
create trigger stock_prevent_business_reassignment before update on public.stock_movements
for each row execute function private.prevent_business_reassignment();
create trigger orders_prevent_business_reassignment before update on public.orders
for each row execute function private.prevent_business_reassignment();
create trigger order_items_prevent_business_reassignment before update on public.order_items
for each row execute function private.prevent_business_reassignment();
create trigger payments_prevent_business_reassignment before update on public.payments
for each row execute function private.prevent_business_reassignment();
create trigger expenses_prevent_business_reassignment before update on public.expenses
for each row execute function private.prevent_business_reassignment();

-- ---------------------------------------------------------------------------
-- Row Level Security: every table in the exposed public schema is protected.
-- ---------------------------------------------------------------------------

alter table public.profiles enable row level security;
alter table public.businesses enable row level security;
alter table public.business_members enable row level security;
alter table public.customers enable row level security;
alter table public.products enable row level security;
alter table public.stock_movements enable row level security;
alter table public.orders enable row level security;
alter table public.order_items enable row level security;
alter table public.payments enable row level security;
alter table public.expenses enable row level security;

create policy profiles_read_own
on public.profiles for select to authenticated
using (id = (select auth.uid()));

create policy profiles_update_own
on public.profiles for update to authenticated
using (id = (select auth.uid()))
with check (id = (select auth.uid()));

create policy businesses_read_member
on public.businesses for select to authenticated
using ((select private.has_business_access(id)));

create policy businesses_create_as_owner
on public.businesses for insert to authenticated
with check (owner_user_id = (select auth.uid()));

create policy businesses_update_owner
on public.businesses for update to authenticated
using (owner_user_id = (select auth.uid()))
with check (owner_user_id = (select auth.uid()));

create policy business_members_read_member
on public.business_members for select to authenticated
using ((select private.has_business_access(business_id)));

create policy business_members_add_by_admin
on public.business_members for insert to authenticated
with check (
  role in ('admin', 'staff')
  and (select private.has_business_role(business_id, array['owner', 'admin']))
);

create policy business_members_update_by_admin
on public.business_members for update to authenticated
using ((select private.has_business_role(business_id, array['owner', 'admin'])))
with check (
  role in ('admin', 'staff')
  and (select private.has_business_role(business_id, array['owner', 'admin']))
);

create policy business_members_remove_non_owner
on public.business_members for delete to authenticated
using (
  user_id <> (
    select b.owner_user_id from public.businesses b where b.id = business_id
  )
  and (select private.has_business_role(business_id, array['owner', 'admin']))
);

create policy customers_read_business
on public.customers for select to authenticated
using ((select private.has_business_access(business_id)));

create policy customers_add_business
on public.customers for insert to authenticated
with check (
  (select private.has_business_access(business_id))
  and (created_by is null or created_by = (select auth.uid()))
);

create policy customers_update_business
on public.customers for update to authenticated
using ((select private.has_business_access(business_id)))
with check ((select private.has_business_access(business_id)));

create policy customers_delete_admin
on public.customers for delete to authenticated
using ((select private.has_business_role(business_id, array['owner', 'admin'])));

create policy products_read_business
on public.products for select to authenticated
using ((select private.has_business_access(business_id)));

create policy products_add_business
on public.products for insert to authenticated
with check (
  (select private.has_business_access(business_id))
  and (created_by is null or created_by = (select auth.uid()))
);

create policy products_update_business
on public.products for update to authenticated
using ((select private.has_business_access(business_id)))
with check ((select private.has_business_access(business_id)));

create policy stock_movements_read_business
on public.stock_movements for select to authenticated
using ((select private.has_business_access(business_id)));

create policy stock_movements_add_business
on public.stock_movements for insert to authenticated
with check (
  (select private.has_business_access(business_id))
  and (created_by is null or created_by = (select auth.uid()))
);

create policy orders_read_business
on public.orders for select to authenticated
using ((select private.has_business_access(business_id)));

create policy orders_add_business
on public.orders for insert to authenticated
with check (
  (select private.has_business_access(business_id))
  and (created_by is null or created_by = (select auth.uid()))
);

create policy orders_update_business
on public.orders for update to authenticated
using ((select private.has_business_access(business_id)))
with check ((select private.has_business_access(business_id)));

create policy order_items_read_business
on public.order_items for select to authenticated
using ((select private.has_business_access(business_id)));

create policy order_items_add_business
on public.order_items for insert to authenticated
with check ((select private.has_business_access(business_id)));

create policy order_items_update_business
on public.order_items for update to authenticated
using ((select private.has_business_access(business_id)))
with check ((select private.has_business_access(business_id)));

create policy order_items_delete_business
on public.order_items for delete to authenticated
using ((select private.has_business_access(business_id)));

create policy payments_read_business
on public.payments for select to authenticated
using ((select private.has_business_access(business_id)));

create policy payments_add_business
on public.payments for insert to authenticated
with check (
  (select private.has_business_access(business_id))
  and (recorded_by is null or recorded_by = (select auth.uid()))
);

create policy expenses_read_business
on public.expenses for select to authenticated
using ((select private.has_business_access(business_id)));

create policy expenses_add_business
on public.expenses for insert to authenticated
with check (
  (select private.has_business_access(business_id))
  and (recorded_by is null or recorded_by = (select auth.uid()))
);

-- ---------------------------------------------------------------------------
-- Explicit API grants. RLS policies above still decide which rows are visible.
-- Transaction ledgers (stock, payments, expenses) are intentionally insert-only.
-- ---------------------------------------------------------------------------

revoke all on table
  public.profiles,
  public.businesses,
  public.business_members,
  public.customers,
  public.products,
  public.stock_movements,
  public.orders,
  public.order_items,
  public.payments,
  public.expenses,
  public.product_stock_levels,
  public.order_financial_summary,
  public.order_cost_summary,
  public.business_expense_summary
from anon, authenticated;

grant usage on schema public to authenticated;

grant select, update on public.profiles to authenticated;
grant select, insert, update on public.businesses to authenticated;
grant select, insert, update, delete on public.business_members to authenticated;
grant select, insert, update, delete on public.customers to authenticated;
grant select, insert, update on public.products to authenticated;
grant select, insert on public.stock_movements to authenticated;
grant select, insert, update on public.orders to authenticated;
grant select, insert, update, delete on public.order_items to authenticated;
grant select, insert on public.payments to authenticated;
grant select, insert on public.expenses to authenticated;

grant select on
  public.product_stock_levels,
  public.order_financial_summary,
  public.order_cost_summary,
  public.business_expense_summary
to authenticated;

commit;
