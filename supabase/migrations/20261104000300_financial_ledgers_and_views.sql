-- SellPilot schema setup: part 3 of 4
-- Run in order. Each part is a separate transaction.
begin;
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
commit;
