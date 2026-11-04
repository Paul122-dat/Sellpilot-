-- Prevent stock movements from being recorded against archived products.
-- The trigger locks the product row, so this also protects against concurrent
-- requests that race with an archive operation.
begin;

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

  if v_is_archived then
    raise exception 'This product is archived and cannot receive stock movements.';
  end if;

  if v_tracks_inventory is not true then
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

commit;
