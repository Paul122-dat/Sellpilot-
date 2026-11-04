-- SellPilot schema setup: part 2 of 4
-- Run in order. Each part is a separate transaction.
begin;
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
as $$
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
$$;

revoke all on function private.validate_order_totals() from public, anon, authenticated;

create trigger validate_order_totals_before_write
before insert or update on public.orders
for each row execute function private.validate_order_totals();
commit;
