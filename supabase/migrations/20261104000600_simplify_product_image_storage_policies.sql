-- Simplify product image Storage RLS checks.
-- The private helper is SECURITY DEFINER and checks business ownership/membership
-- without relying on a second RLS-filtered query against public.businesses.
begin;

drop policy if exists sellpilot_product_images_read on storage.objects;
create policy sellpilot_product_images_read
on storage.objects for select
to authenticated
using (
  bucket_id = 'product-images'
  and case
    when (storage.foldername(name))[1] ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
    then private.has_business_access(((storage.foldername(name))[1])::uuid)
    else false
  end
);

drop policy if exists sellpilot_product_images_add on storage.objects;
create policy sellpilot_product_images_add
on storage.objects for insert
to authenticated
with check (
  bucket_id = 'product-images'
  and case
    when (storage.foldername(name))[1] ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
    then private.has_business_access(((storage.foldername(name))[1])::uuid)
    else false
  end
);

drop policy if exists sellpilot_product_images_update on storage.objects;
create policy sellpilot_product_images_update
on storage.objects for update
to authenticated
using (
  bucket_id = 'product-images'
  and case
    when (storage.foldername(name))[1] ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
    then private.has_business_access(((storage.foldername(name))[1])::uuid)
    else false
  end
)
with check (
  bucket_id = 'product-images'
  and case
    when (storage.foldername(name))[1] ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
    then private.has_business_access(((storage.foldername(name))[1])::uuid)
    else false
  end
);

drop policy if exists sellpilot_product_images_delete on storage.objects;
create policy sellpilot_product_images_delete
on storage.objects for delete
to authenticated
using (
  bucket_id = 'product-images'
  and case
    when (storage.foldername(name))[1] ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
    then private.has_business_access(((storage.foldername(name))[1])::uuid)
    else false
  end
);

commit;
