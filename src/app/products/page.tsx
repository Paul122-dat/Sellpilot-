import Link from "next/link";
import { redirect } from "next/navigation";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import ProductManager, { type ProductRecord } from "./product-manager";

export default async function ProductsPage() {
  const supabase = await createSupabaseServerClient();
  const { data: claimsData, error: claimsError } = await supabase.auth.getClaims();
  const userId = claimsData?.claims?.sub;

  if (claimsError || typeof userId !== "string") redirect("/login");

  const { data: membership, error: membershipError } = await supabase
    .from("business_members")
    .select("business_id")
    .eq("user_id", userId)
    .limit(1)
    .maybeSingle();

  if (membershipError) {
    return <main className="min-h-screen bg-[var(--surface)] p-6"><p className="mx-auto max-w-3xl rounded-2xl bg-white p-6 text-sm text-slate-600">We couldn't load your workspace. Please refresh and try again.</p></main>;
  }
  if (!membership?.business_id) redirect("/onboarding");

  const [{ data: products, error: productsError }, { data: stock, error: stockError }] = await Promise.all([
    supabase
      .from("products")
      .select("id, business_id, name, sku, description, selling_price, cost_price, track_inventory, low_stock_threshold, is_archived, image_path, created_at")
      .eq("business_id", membership.business_id)
      .order("created_at", { ascending: false }),
    supabase
      .from("product_stock_levels")
      .select("product_id, stock_on_hand, stock_status")
      .eq("business_id", membership.business_id),
  ]);

  if (productsError || stockError) {
    return <main className="min-h-screen bg-[var(--surface)] p-6"><p className="mx-auto max-w-3xl rounded-2xl bg-white p-6 text-sm text-slate-600">We couldn't load your product records. Please refresh and try again.</p></main>;
  }

  const imagePaths = (products ?? [])
    .map((product) => product.image_path)
    .filter((path): path is string => Boolean(path));

  const signedImages = imagePaths.length > 0
    ? await supabase.storage.from("product-images").createSignedUrls(imagePaths, 60 * 60)
    : { data: [], error: null };

  if (signedImages.error) {
    return <main className="min-h-screen bg-[var(--surface)] p-6"><p className="mx-auto max-w-3xl rounded-2xl bg-white p-6 text-sm text-slate-600">We couldn't load product images. Please refresh and try again.</p></main>;
  }

  const records: ProductRecord[] = (products ?? []).map((product) => {
    const level = (stock ?? []).find((row) => row.product_id === product.id);
    const image = product.image_path
      ? (signedImages.data ?? []).find((item) => item.path === product.image_path)
      : null;
    return {
      ...product,
      image_url: image?.signedUrl ?? null,
      stock_on_hand: level?.stock_on_hand ?? null,
      stock_status: level?.stock_status ?? (product.track_inventory ? "low_stock" : "not_tracked"),
    } as ProductRecord;
  });

  return (
    <main className="min-h-screen bg-[var(--surface)] px-4 py-6 sm:px-8">
      <div className="mx-auto max-w-6xl">
        <Link href="/" className="text-sm font-semibold text-[var(--orange)]">← Back to overview</Link>
        <div className="mt-5">
          <p className="text-sm font-medium text-[var(--orange)]">Workspace</p>
          <h1 className="mt-1 text-3xl font-bold tracking-tight text-[var(--navy)]">Products & stock</h1>
          <p className="mt-2 text-sm text-slate-500">Manage your catalogue, product photos, selling prices and stock records.</p>
        </div>
        <div className="mt-7"><ProductManager initialProducts={records} businessId={membership.business_id} /></div>
      </div>
    </main>
  );
}
