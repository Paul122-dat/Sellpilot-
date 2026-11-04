-- Order Management: atomic order creation and inventory-safe lifecycle.
-- Apply once, after migrations 001-007.
begin;

-- Order-item changes are allowed only while an order is pending. Once confirmed,
-- item and price snapshots become immutable so stock movements cannot drift.
create or replace function private.prevent_non_pending_order_item_changes()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  v_order_id uuid;
  v_business_id uuid;
  v_status text;
begin
  if tg_op = 'INSERT' then
    v_order_id := new.order_id;
    v_business_id := new.business_id;
  else
    v_order_id := old.order_id;
    v_business_id := old.business_id;
  end if;

  select o.order_status
    into v_status
  from public.orders o
  where o.id = v_order_id
    and o.business_id = v_business_id;

  if not found or v_status <> 'pending' then
    raise exception 'Items can only be changed while an order is pending.';
  end if;

  if tg_op = 'DELETE' then
    return old;
  end if;
  return new;
end;
$$;

revoke all on function private.prevent_non_pending_order_item_changes() from public, anon, authenticated;

create trigger order_items_pending_only
before insert or update or delete on public.order_items
for each row execute function private.prevent_non_pending_order_item_changes();

-- Product snapshots are read from the seller's own active catalogue.
create or replace function private.validate_order_item_product()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  v_product_name text;
  v_cost_price numeric(14,2);
  v_is_archived boolean;
begin
  if new.product_id is not null then
    select p.name, p.cost_price, p.is_archived
      into v_product_name, v_cost_price, v_is_archived
    from public.products p
    where p.id = new.product_id
      and p.business_id = new.business_id;

    if not found then
      raise exception 'The selected product does not belong to this business.';
    end if;

    if v_is_archived then
      raise exception 'Archived products cannot be added to new orders.';
    end if;

    if tg_op = 'INSERT' then
      new.product_name := v_product_name;
      if new.unit_cost is null then
        new.unit_cost := v_cost_price;
      end if;
    elsif new.product_id is distinct from old.product_id then
      new.product_name := v_product_name;
      if new.unit_cost is null then
        new.unit_cost := v_cost_price;
      end if;
    end if;
  end if;

  return new;
end;
$$;

revoke all on function private.validate_order_item_product() from public, anon, authenticated;

-- This trigger must update the calculated subtotal even though authenticated
-- users are granted updates only to operational order columns.
create or replace function private.recalculate_order_subtotal()
returns trigger
language plpgsql
security definer
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

-- Allow only valid forward status changes. Confirming an order deducts tracked
-- stock once; cancelling a confirmed order restores exactly those quantities.
create or replace function private.handle_order_status_change()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_item record;
  v_available bigint;
  v_is_archived boolean;
begin
  if new.order_status is not distinct from old.order_status then
    return new;
  end if;

  if old.order_status in ('delivered', 'cancelled') then
    raise exception 'A delivered or cancelled order cannot be changed.';
  end if;

  if new.order_status = 'cancelled' then
    if old.order_status in ('confirmed', 'processing', 'ready', 'dispatched') then
      for v_item in
        select sm.product_id, sum(-sm.quantity_change)::integer as quantity
        from public.stock_movements sm
        where sm.business_id = old.business_id
          and sm.reference = old.id::text
          and sm.movement_type = 'sale'
        group by sm.product_id
      loop
        insert into public.stock_movements (
          business_id, product_id, movement_type, quantity_change,
          note, reference, created_by
        ) values (
          old.business_id, v_item.product_id, 'return', v_item.quantity,
          'Stock restored because order ' || coalesce(old.order_number, old.id::text) || ' was cancelled',
          'cancel:' || old.id::text, auth.uid()
        );
      end loop;
    end if;

    return new;
  end if;

  if not (
    (old.order_status = 'pending' and new.order_status = 'confirmed')
    or (old.order_status = 'confirmed' and new.order_status = 'processing')
    or (old.order_status = 'processing' and new.order_status = 'ready')
    or (old.order_status = 'ready' and new.order_status = 'dispatched')
    or (old.order_status = 'dispatched' and new.order_status = 'delivered')
  ) then
    raise exception 'Move the order to the next stage or cancel it.';
  end if;

  if old.order_status = 'pending' and new.order_status = 'confirmed' then
    for v_item in
      select oi.product_id, sum(oi.quantity)::integer as quantity
      from public.order_items oi
      join public.products p
        on p.id = oi.product_id
       and p.business_id = oi.business_id
      where oi.order_id = old.id
        and oi.business_id = old.business_id
        and p.track_inventory = true
      group by oi.product_id
      order by oi.product_id
    loop
      select p.is_archived
        into v_is_archived
      from public.products p
      where p.id = v_item.product_id
        and p.business_id = old.business_id
      for update;

      if not found or v_is_archived then
        raise exception 'A product in this order is archived. Restore it before confirming the order.';
      end if;

      select coalesce(sum(sm.quantity_change), 0)
        into v_available
      from public.stock_movements sm
      where sm.product_id = v_item.product_id
        and sm.business_id = old.business_id;

      if v_available < v_item.quantity then
        raise exception 'Insufficient stock: % available, % required.',
          v_available, v_item.quantity;
      end if;

      insert into public.stock_movements (
        business_id, product_id, movement_type, quantity_change,
        note, reference, created_by
      ) values (
        old.business_id, v_item.product_id, 'sale', -v_item.quantity,
        'Stock deducted for order ' || coalesce(old.order_number, old.id::text),
        old.id::text, auth.uid()
      );
    end loop;
  end if;

  return new;
end;
$$;

revoke all on function private.handle_order_status_change() from public, anon, authenticated;

create trigger orders_status_lifecycle
after update of order_status on public.orders
for each row execute function private.handle_order_status_change();

-- Archived stock may be restored only as the exact reversal of a sale created
-- for the same cancelled order. Other movements remain blocked for archived
-- products, while legitimate order cancellation can always finish.
create or replace function private.validate_stock_movement()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_tracks_inventory boolean;
  v_is_archived boolean;
  v_current_stock bigint;
  v_order_text text;
  v_order_id uuid;
  v_sale_quantity bigint;
  v_returned_quantity bigint;
begin
  if not private.has_business_access(new.business_id) then
    raise exception 'You do not have access to this business.';
  end if;

  select p.track_inventory, p.is_archived
    into v_tracks_inventory, v_is_archived
  from public.products p
  where p.id = new.product_id
    and p.business_id = new.business_id
  for update;

  if not found then
    raise exception 'The selected product was not found for this business.';
  end if;

  if v_tracks_inventory is not true then
    raise exception 'This product does not have tracked inventory.';
  end if;

  if v_is_archived then
    if new.movement_type <> 'return'
      or new.reference is null
      or new.reference not like 'cancel:%' then
      raise exception 'This product is archived and cannot receive stock movements.';
    end if;

    v_order_text := substring(new.reference from 8);
    if v_order_text !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then
      raise exception 'This stock restoration reference is invalid.';
    end if;
    v_order_id := v_order_text::uuid;

    if not exists (
      select 1 from public.orders o
      where o.id = v_order_id
        and o.business_id = new.business_id
        and o.order_status = 'cancelled'
    ) then
      raise exception 'Stock can only be restored for a cancelled order.';
    end if;

    select coalesce(sum(-sm.quantity_change), 0)
      into v_sale_quantity
    from public.stock_movements sm
    where sm.business_id = new.business_id
      and sm.product_id = new.product_id
      and sm.reference = v_order_id::text
      and sm.movement_type = 'sale';

    select coalesce(sum(sm.quantity_change), 0)
      into v_returned_quantity
    from public.stock_movements sm
    where sm.business_id = new.business_id
      and sm.product_id = new.product_id
      and sm.reference = new.reference
      and sm.movement_type = 'return';

    if v_sale_quantity = 0 or v_returned_quantity + new.quantity_change > v_sale_quantity then
      raise exception 'This stock restoration exceeds the quantity sold for that order.';
    end if;
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

-- One transaction: header, item price/cost snapshots, calculated totals and an
-- optional first payment either all save or none of them do.
create or replace function public.create_order(
  p_business_id uuid,
  p_customer_id uuid,
  p_customer_name text,
  p_customer_phone text,
  p_sales_channel text,
  p_items jsonb,
  p_discount_amount numeric default 0,
  p_delivery_fee numeric default 0,
  p_expected_delivery_date date default null,
  p_delivery_address text default null,
  p_notes text default null,
  p_initial_payment_amount numeric default 0,
  p_initial_payment_method text default null,
  p_initial_payment_reference text default null,
  p_initial_payment_note text default null
)
returns uuid
language plpgsql
set search_path = ''
as $$
declare
  v_order_id uuid := gen_random_uuid();
  v_order_number text;
  v_customer_name text;
  v_customer_phone text;
  v_customer_address text;
  v_item jsonb;
  v_product_id uuid;
  v_product_name text;
  v_unit_price numeric(14,2);
  v_quantity integer;
  v_subtotal numeric(14,2);
  v_total numeric(14,2);
  v_initial_payment numeric(14,2) := coalesce(p_initial_payment_amount, 0);
begin
  if auth.uid() is null or not private.has_business_access(p_business_id) then
    raise exception 'You do not have access to this business.';
  end if;

  if p_sales_channel not in ('whatsapp', 'instagram', 'in_person', 'other') then
    raise exception 'Choose a valid sales channel.';
  end if;

  if p_items is null or jsonb_typeof(p_items) <> 'array'
    or jsonb_array_length(p_items) < 1
    or jsonb_array_length(p_items) > 50 then
    raise exception 'Add between 1 and 50 products to the order.';
  end if;

  if coalesce(p_discount_amount, 0) < 0 or coalesce(p_delivery_fee, 0) < 0 then
    raise exception 'Discount and delivery fee cannot be negative.';
  end if;

  if v_initial_payment < 0 then
    raise exception 'Initial payment cannot be negative.';
  end if;

  if p_customer_id is not null then
    select c.name,
           coalesce(nullif(c.phone_number, ''), nullif(c.whatsapp_number, '')),
           c.delivery_address
      into v_customer_name, v_customer_phone, v_customer_address
    from public.customers c
    where c.id = p_customer_id
      and c.business_id = p_business_id;

    if not found then
      raise exception 'The selected customer does not belong to this business.';
    end if;
  else
    v_customer_name := nullif(trim(coalesce(p_customer_name, '')), '');
    v_customer_phone := null;
    v_customer_address := null;
  end if;

  if v_customer_name is null or length(v_customer_name) > 160 then
    raise exception 'Enter a valid customer name.';
  end if;

  if p_customer_id is null and p_customer_phone is not null then
    v_customer_phone := left(nullif(trim(p_customer_phone), ''), 40);
  elsif p_customer_phone is not null and trim(p_customer_phone) <> '' then
    v_customer_phone := left(trim(p_customer_phone), 40);
  end if;

  v_order_number := 'SP-' || to_char(now(), 'YYMMDD') || '-' ||
    upper(substring(replace(v_order_id::text, '-', '') from 1 for 6));

  insert into public.orders (
    id, business_id, order_number, customer_id, customer_name, customer_phone,
    sales_channel, order_status, currency_code, subtotal_amount,
    discount_amount, delivery_fee, expected_delivery_date,
    delivery_address, notes, created_by
  ) values (
    v_order_id, p_business_id, v_order_number, p_customer_id, v_customer_name,
    v_customer_phone, p_sales_channel, 'pending', 'NGN', 0, 0, 0,
    p_expected_delivery_date,
    left(coalesce(nullif(trim(p_delivery_address), ''), v_customer_address), 1000),
    left(nullif(trim(coalesce(p_notes, '')), ''), 2000),
    auth.uid()
  );

  for v_item in select value from jsonb_array_elements(p_items)
  loop
    if coalesce(v_item->>'product_id', '') !~*
      '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then
      raise exception 'One of the selected products is invalid.';
    end if;

    if coalesce(v_item->>'quantity', '') !~ '^[1-9][0-9]{0,5}$' then
      raise exception 'Product quantities must be whole numbers between 1 and 999999.';
    end if;

    v_product_id := (v_item->>'product_id')::uuid;
    v_quantity := (v_item->>'quantity')::integer;

    select p.name, p.selling_price
      into v_product_name, v_unit_price
    from public.products p
    where p.id = v_product_id
      and p.business_id = p_business_id
      and p.is_archived = false;

    if not found then
      raise exception 'A selected product is unavailable or archived.';
    end if;

    insert into public.order_items (
      business_id, order_id, product_id, product_name, quantity, unit_price, unit_cost
    ) values (
      p_business_id, v_order_id, v_product_id, v_product_name, v_quantity, v_unit_price, null
    );
  end loop;

  select o.subtotal_amount
    into v_subtotal
  from public.orders o
  where o.id = v_order_id
    and o.business_id = p_business_id;

  if coalesce(p_discount_amount, 0) > v_subtotal then
    raise exception 'Discount cannot be greater than the order subtotal.';
  end if;

  update public.orders
  set discount_amount = coalesce(p_discount_amount, 0),
      delivery_fee = coalesce(p_delivery_fee, 0)
  where id = v_order_id
    and business_id = p_business_id;

  select o.total_amount
    into v_total
  from public.orders o
  where o.id = v_order_id
    and o.business_id = p_business_id;

  if v_initial_payment > 0 then
    if p_initial_payment_method not in ('cash', 'bank_transfer', 'card', 'online', 'other') then
      raise exception 'Choose a valid payment method for the initial payment.';
    end if;

    insert into public.payments (
      business_id, order_id, transaction_type, amount, payment_method,
      reference, note, recorded_by
    ) values (
      p_business_id, v_order_id, 'payment', v_initial_payment,
      p_initial_payment_method,
      left(nullif(trim(coalesce(p_initial_payment_reference, '')), ''), 160),
      left(nullif(trim(coalesce(p_initial_payment_note, '')), ''), 500),
      auth.uid()
    );
  end if;

  return v_order_id;
end;
$$;

revoke all on function public.create_order(
  uuid, uuid, text, text, text, jsonb, numeric, numeric, date, text, text,
  numeric, text, text, text
) from public, anon, authenticated;

grant execute on function public.create_order(
  uuid, uuid, text, text, text, jsonb, numeric, numeric, date, text, text,
  numeric, text, text, text
) to authenticated;

-- Keep cancelled orders from accepting new payments. Refunds remain bounded
-- by the amount actually received, including earlier refunds.
create or replace function private.validate_refund_entry()
returns trigger
language plpgsql
security definer
set search_path = ''
as $
declare
  v_order_status text;
  v_received numeric(14,2);
  v_refunded numeric(14,2);
begin
  if not private.has_business_access(new.business_id) then
    raise exception 'You do not have access to this business.';
  end if;

  select o.order_status
    into v_order_status
  from public.orders o
  where o.id = new.order_id
    and o.business_id = new.business_id
  for update;

  if not found then
    raise exception 'The selected order was not found for this business.';
  end if;

  if new.transaction_type = 'payment' and v_order_status = 'cancelled' then
    raise exception 'A cancelled order cannot accept another payment.';
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
$;

revoke all on function private.validate_refund_entry() from public, anon, authenticated;

-- Users can change operational fields only; monetary totals are controlled by
-- order-item triggers and the atomic order-creation function.
revoke update on public.orders from authenticated;
grant update (order_status, expected_delivery_date, delivery_address, notes)
  on public.orders to authenticated;

commit;
