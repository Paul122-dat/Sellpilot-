-- SellPilot schema setup: part 4 of 4
-- Run in order. Each part is a separate transaction.
begin;
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
  and created_by = (select auth.uid())
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
  and created_by = (select auth.uid())
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
  and created_by = (select auth.uid())
);

create policy orders_read_business
on public.orders for select to authenticated
using ((select private.has_business_access(business_id)));

create policy orders_add_business
on public.orders for insert to authenticated
with check (
  (select private.has_business_access(business_id))
  and created_by = (select auth.uid())
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
  and recorded_by = (select auth.uid())
);

create policy expenses_read_business
on public.expenses for select to authenticated
using ((select private.has_business_access(business_id)));

create policy expenses_add_business
on public.expenses for insert to authenticated
with check (
  (select private.has_business_access(business_id))
  and recorded_by = (select auth.uid())
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
