-- SellPilot product image storage
-- Run once in the Supabase SQL Editor before testing the product image upload.
begin;

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'product-images',
  'product-images',
  false,
  5242880,
  array['image/jpeg', 'image/png', 'image/webp']
)
on conflict (id) do update
set
  public = false,
  file_size_limit = 5242880,
  allowed_mime_types = array['image/jpeg', 'image/png', 'image/webp'];

alter table public.products
  add column if not exists image_path text;

drop policy if exists sellpilot_product_images_read on storage.objects;
create policy sellpilot_product_images_read
on storage.objects for select
to authenticated
using (
  bucket_id = 'product-images'
  and exists (
    select 1
    from public.businesses b
    where b.id::text = (storage.foldername(name))[1]
      and private.has_business_access(b.id)
  )
);

drop policy if exists sellpilot_product_images_add on storage.objects;
create policy sellpilot_product_images_add
on storage.objects for insert
to authenticated
with check (
  bucket_id = 'product-images'
  and exists (
    select 1
    from public.businesses b
    where b.id::text = (storage.foldername(name))[1]
      and private.has_business_access(b.id)
  )
);

drop policy if exists sellpilot_product_images_update on storage.objects;
create policy sellpilot_product_images_update
on storage.objects for update
to authenticated
using (
  bucket_id = 'product-images'
  and exists (
    select 1
    from public.businesses b
    where b.id::text = (storage.foldername(name))[1]
      and private.has_business_access(b.id)
  )
)
with check (
  bucket_id = 'product-images'
  and exists (
    select 1
    from public.businesses b
    where b.id::text = (storage.foldername(name))[1]
      and private.has_business_access(b.id)
  )
);

drop policy if exists sellpilot_product_images_delete on storage.objects;
create policy sellpilot_product_images_delete
on storage.objects for delete
to authenticated
using (
  bucket_id = 'product-images'
  and exists (
    select 1
    from public.businesses b
    where b.id::text = (storage.foldername(name))[1]
      and private.has_business_access(b.id)
  )
);

commit;
