"use client";

import { useEffect, useMemo, useState, useTransition, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import {
  archiveProduct,
  attachProductImage,
  createProduct,
  recordStockAdjustment,
  updateProduct,
} from "./actions";
import { createSupabaseBrowserClient } from "@/lib/supabase/client";

const IMAGE_BUCKET = "product-images";
const MAX_IMAGE_BYTES = 5 * 1024 * 1024;
const IMAGE_EXTENSIONS: Record<string, string> = {
  "image/jpeg": "jpg",
  "image/png": "png",
  "image/webp": "webp",
};

export type ProductRecord = {
  id: string;
  business_id: string;
  name: string;
  sku: string | null;
  description: string | null;
  selling_price: number;
  cost_price: number | null;
  track_inventory: boolean;
  low_stock_threshold: number;
  is_archived: boolean;
  created_at: string;
  image_url: string | null;
  stock_on_hand: number | null;
  stock_status: "in_stock" | "low_stock" | "not_tracked";
};

const emptyForm = {
  name: "",
  sku: "",
  description: "",
  selling_price: "",
  cost_price: "",
  track_inventory: true,
  low_stock_threshold: "5",
};

function money(value: number) {
  return new Intl.NumberFormat("en-NG", { style: "currency", currency: "NGN", maximumFractionDigits: 2 }).format(value);
}

export default function ProductManager({
  initialProducts,
  businessId,
}: {
  initialProducts: ProductRecord[];
  businessId: string;
}) {
  const router = useRouter();
  const [query, setQuery] = useState("");
  const [showArchived, setShowArchived] = useState(false);
  const [editing, setEditing] = useState<ProductRecord | null>(null);
  const [form, setForm] = useState(emptyForm);
  const [error, setError] = useState("");
  const [imagePreview, setImagePreview] = useState<string | null>(null);
  const [formVersion, setFormVersion] = useState(0);
  const [isPending, startTransition] = useTransition();
  const [stockProduct, setStockProduct] = useState("");
  const [stockDirection, setStockDirection] = useState<"add" | "remove">("add");
  const [stockQuantity, setStockQuantity] = useState("1");
  const [stockNote, setStockNote] = useState("");
  const [stockError, setStockError] = useState("");

  useEffect(() => {
    if (!imagePreview?.startsWith("blob:")) return;
    return () => URL.revokeObjectURL(imagePreview);
  }, [imagePreview]);

  const activeProducts = initialProducts.filter((product) => !product.is_archived);
  const lowStockCount = activeProducts.filter((product) => product.stock_status === "low_stock").length;
  const filtered = useMemo(() => {
    const term = query.trim().toLowerCase();
    return initialProducts.filter((product) => {
      if (product.is_archived !== showArchived) return false;
      return !term || [product.name, product.sku, product.description].some((value) => value?.toLowerCase().includes(term));
    });
  }, [initialProducts, query, showArchived]);

  function openNew() {
    setEditing(null);
    setForm(emptyForm);
    setImagePreview(null);
    setFormVersion((version) => version + 1);
    setError("");
  }

  function openEdit(product: ProductRecord) {
    setEditing(product);
    setForm({
      name: product.name,
      sku: product.sku ?? "",
      description: product.description ?? "",
      selling_price: String(product.selling_price),
      cost_price: product.cost_price === null ? "" : String(product.cost_price),
      track_inventory: product.track_inventory,
      low_stock_threshold: String(product.low_stock_threshold),
    });
    setImagePreview(product.image_url);
    setError("");
  }

  function submitProduct(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError("");

    const formElement = event.currentTarget;
    const data = new FormData(formElement);
    const selectedFile = data.get("image");
    const imageFile = selectedFile instanceof File && selectedFile.size > 0
      ? selectedFile
      : null;
    const productBeingEdited = editing;
    data.delete("image");

    if (imageFile && !IMAGE_EXTENSIONS[imageFile.type]) {
      setError("Use a JPG, PNG or WebP product image.");
      return;
    }
    if (imageFile && imageFile.size > MAX_IMAGE_BYTES) {
      setError("Product images must be 5 MB or smaller.");
      return;
    }

    startTransition(async () => {
      try {
        const result = productBeingEdited
          ? await updateProduct(productBeingEdited.id, data)
          : await createProduct(data);

        if (result.error || !result.productId) {
          setError(result.error ?? "We couldn't save this product. Please try again.");
          return;
        }

        if (imageFile) {
          const extension = IMAGE_EXTENSIONS[imageFile.type];
          const path = businessId + "/" + result.productId + "/" + crypto.randomUUID() + "." + extension;
          const supabase = createSupabaseBrowserClient();
          const { error: uploadError } = await supabase.storage.from(IMAGE_BUCKET).upload(path, imageFile, {
            cacheControl: "3600",
            contentType: imageFile.type,
            upsert: false,
          });

          if (uploadError) {
            console.error("SellPilot product photo upload failed.", {
              statusCode: uploadError.statusCode,
              message: uploadError.message,
            });
            if (!productBeingEdited) {
              setEditing(null);
              setForm(emptyForm);
              setImagePreview(null);
              setFormVersion((version) => version + 1);
            }
            setError(
              productBeingEdited
                ? "Product details were saved, but the photo could not be uploaded. Your existing photo was kept; please try the new photo again."
                : "The product was saved, but its photo could not be uploaded. Find the product in the catalogue and edit it to try the photo again.",
            );
            router.refresh();
            return;
          }

          const attachResult = await attachProductImage(result.productId, path);
          if (attachResult.error) {
            await supabase.storage.from(IMAGE_BUCKET).remove([path]);
            if (!productBeingEdited) {
              setEditing(null);
              setForm(emptyForm);
              setImagePreview(null);
              setFormVersion((version) => version + 1);
            }
            setError(
              productBeingEdited
                ? "Product details were saved, but we couldn't attach the new photo. Your existing photo was kept."
                : "The product was saved, but we couldn't attach its photo. Find the product in the catalogue and try again.",
            );
            router.refresh();
            return;
          }
        }

        setEditing(null);
        setForm(emptyForm);
        setImagePreview(null);
        setFormVersion((version) => version + 1);
        router.refresh();
      } catch {
        setError("We couldn't save the product. Check your connection and try again.");
      }
    });
  }

  function submitStock(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setStockError("");
    const data = new FormData(event.currentTarget);
    startTransition(async () => {
      const result = await recordStockAdjustment(data);
      if (result.error) {
        setStockError(result.error);
        return;
      }
      setStockQuantity("1");
      setStockNote("");
      router.refresh();
    });
  }

  function archive(product: ProductRecord) {
    if (!window.confirm(`Archive "${product.name}"? It will be hidden from the active catalogue, but its history will be preserved.`)) return;
    startTransition(async () => {
      const result = await archiveProduct(product.id);
      if (result.error) setError(result.error);
      else {
        setEditing(null);
        setForm(emptyForm);
        setImagePreview(null);
        setFormVersion((version) => version + 1);
        setError("");
        router.refresh();
      }
    });
  }

  return (
    <div className="space-y-6">
      <div className="grid gap-3 sm:grid-cols-3">
        <article className="rounded-2xl border border-[var(--line)] bg-white p-4"><p className="text-xs font-medium text-slate-500">Active products</p><p className="mt-2 text-2xl font-bold text-[var(--navy)]">{activeProducts.length}</p></article>
        <article className="rounded-2xl border border-[var(--line)] bg-white p-4"><p className="text-xs font-medium text-slate-500">Low-stock products</p><p className="mt-2 text-2xl font-bold text-amber-600">{lowStockCount}</p></article>
        <article className="rounded-2xl border border-[var(--line)] bg-white p-4"><p className="text-xs font-medium text-slate-500">Archived products</p><p className="mt-2 text-2xl font-bold text-[var(--navy)]">{initialProducts.length - activeProducts.length}</p></article>
      </div>

      <div className="grid gap-6 lg:grid-cols-[minmax(0,1.2fr)_minmax(300px,.8fr)]">
        <section className="rounded-2xl border border-[var(--line)] bg-white p-5 shadow-sm sm:p-6">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div><h2 className="font-bold text-[var(--navy)]">Product catalogue</h2><p className="mt-1 text-xs text-slate-500">{filtered.length} {showArchived ? "archived" : "active"} products shown</p></div>
            <button type="button" onClick={openNew} className="rounded-xl bg-[var(--orange)] px-4 py-2.5 text-sm font-bold text-white">Add product</button>
          </div>
          <input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search product name or SKU" aria-label="Search products" className="mt-5 w-full rounded-xl border border-[var(--line)] px-4 py-3 text-sm outline-none focus:border-orange-400" />
          <div className="mt-4 flex items-center justify-between"><label className="flex items-center gap-2 text-xs font-medium text-slate-600"><input type="checkbox" checked={showArchived} onChange={(event) => setShowArchived(event.target.checked)} />Show archived</label><span className="text-xs text-slate-400">Tap a product to edit</span></div>
          <div className="mt-3 divide-y divide-slate-100">
            {filtered.length === 0 ? <div className="py-12 text-center"><p className="text-sm font-semibold text-slate-700">No products found</p><p className="mt-1 text-xs text-slate-500">Add a product or change your search.</p></div> : filtered.map((product) => (
              <button key={product.id} type="button" onClick={() => openEdit(product)} className="flex w-full items-center gap-3 py-4 text-left hover:bg-slate-50">
                {product.image_url ? <img src={product.image_url} alt={product.name} className="h-12 w-12 shrink-0 rounded-xl border border-[var(--line)] object-cover" /> : <span className="grid h-12 w-12 shrink-0 place-items-center rounded-xl bg-orange-50 text-sm font-bold text-[var(--orange)]">{product.name.slice(0, 1).toUpperCase()}</span>}
                <span className="min-w-0 flex-1"><span className="block truncate text-sm font-semibold text-slate-800">{product.name}</span><span className="mt-1 block truncate text-xs text-slate-500">{product.sku || "No SKU"} · {money(Number(product.selling_price))}</span></span>
                <span className="text-right"><span className="block text-sm font-semibold text-slate-700">{product.stock_on_hand === null ? "Not tracked" : `${product.stock_on_hand} in stock`}</span><span className={`mt-1 block text-[11px] font-semibold ${product.is_archived ? "text-slate-400" : product.stock_status === "low_stock" ? "text-amber-600" : product.stock_status === "in_stock" ? "text-emerald-600" : "text-slate-400"}`}>{product.is_archived ? "Archived" : product.stock_status === "low_stock" ? "Low stock" : product.stock_status === "in_stock" ? "In stock" : "Not tracked"}</span></span>
              </button>
            ))}
          </div>
        </section>

        <div className="space-y-6">
          <section className="rounded-2xl border border-[var(--line)] bg-white p-5 shadow-sm sm:p-6">
            <h2 className="font-bold text-[var(--navy)]">{editing ? "Edit product" : "New product"}</h2>
            <p className="mt-1 text-xs leading-5 text-slate-500">Selling price is required. Cost price is optional until you know it.</p>
            <form key={`${editing?.id ?? "new"}-${formVersion}`} onSubmit={submitProduct} className="mt-5 space-y-3">
              <div className="rounded-xl border border-dashed border-slate-300 p-3">
                <label className="block"><span className="mb-2 block text-xs font-semibold text-slate-600">Product photo (optional)</span><input name="image" type="file" accept="image/jpeg,image/png,image/webp" onChange={(event) => { const file = event.target.files?.[0]; if (file) setImagePreview(URL.createObjectURL(file)); }} className="block w-full text-xs text-slate-600 file:mr-3 file:rounded-lg file:border-0 file:bg-orange-50 file:px-3 file:py-2 file:text-xs file:font-semibold file:text-[var(--orange)]" /><span className="mt-1 block text-[11px] text-slate-400">JPG, PNG or WebP · maximum 5 MB. Choose from your phone or take a photo.</span></label>
                {imagePreview && <div className="mt-3 flex items-center gap-3"><img src={imagePreview} alt="Product photo preview" className="h-20 w-20 rounded-xl border border-[var(--line)] object-cover" /><span className="text-xs text-slate-500">Photo preview</span></div>}
              </div>
              <label className="block"><span className="mb-1.5 block text-xs font-semibold text-slate-600">Product name *</span><input name="name" required maxLength={160} value={form.name} onChange={(e) => setForm((s) => ({ ...s, name: e.target.value }))} placeholder="e.g. Classic T-shirt" className="w-full rounded-xl border border-[var(--line)] px-3.5 py-2.5 text-sm outline-none focus:border-orange-400" /></label>
              <label className="block"><span className="mb-1.5 block text-xs font-semibold text-slate-600">SKU / product code</span><input name="sku" maxLength={80} value={form.sku} onChange={(e) => setForm((s) => ({ ...s, sku: e.target.value }))} placeholder="Optional unique code" className="w-full rounded-xl border border-[var(--line)] px-3.5 py-2.5 text-sm outline-none focus:border-orange-400" /></label>
              <div className="grid grid-cols-2 gap-3">
                <label className="block"><span className="mb-1.5 block text-xs font-semibold text-slate-600">Selling price (₦) *</span><input name="selling_price" type="number" min="0" step="0.01" required value={form.selling_price} onChange={(e) => setForm((s) => ({ ...s, selling_price: e.target.value }))} className="w-full rounded-xl border border-[var(--line)] px-3 py-2.5 text-sm outline-none focus:border-orange-400" /></label>
                <label className="block"><span className="mb-1.5 block text-xs font-semibold text-slate-600">Cost price (₦)</span><input name="cost_price" type="number" min="0" step="0.01" value={form.cost_price} onChange={(e) => setForm((s) => ({ ...s, cost_price: e.target.value }))} className="w-full rounded-xl border border-[var(--line)] px-3 py-2.5 text-sm outline-none focus:border-orange-400" /></label>
              </div>
              <label className="block"><span className="mb-1.5 block text-xs font-semibold text-slate-600">Description</span><textarea name="description" rows={2} maxLength={2000} value={form.description} onChange={(e) => setForm((s) => ({ ...s, description: e.target.value }))} placeholder="Optional product details" className="w-full rounded-xl border border-[var(--line)] px-3.5 py-2.5 text-sm outline-none focus:border-orange-400" /></label>
              <label className="flex items-center gap-2 text-sm font-medium text-slate-700"><input name="track_inventory" type="checkbox" checked={form.track_inventory} onChange={(e) => setForm((s) => ({ ...s, track_inventory: e.target.checked }))} />Track stock for this product</label>
              {!form.track_inventory && <input type="hidden" name="low_stock_threshold" value={form.low_stock_threshold} />}
              {form.track_inventory && <label className="block"><span className="mb-1.5 block text-xs font-semibold text-slate-600">Low-stock warning at</span><input name="low_stock_threshold" type="number" min="0" max="999999" step="1" value={form.low_stock_threshold} onChange={(e) => setForm((s) => ({ ...s, low_stock_threshold: e.target.value }))} className="w-full rounded-xl border border-[var(--line)] px-3.5 py-2.5 text-sm outline-none focus:border-orange-400" /></label>}
              {error && <p role="alert" className="rounded-xl bg-red-50 p-3 text-xs text-red-700">{error}</p>}
              <div className="flex gap-2 pt-1"><button disabled={isPending} type="submit" className="flex-1 rounded-xl bg-[var(--orange)] px-4 py-3 text-sm font-bold text-white disabled:opacity-60">{isPending ? "Saving..." : editing ? "Save changes" : "Save product"}</button>{editing && <button type="button" onClick={openNew} className="rounded-xl border border-[var(--line)] px-4 py-3 text-sm font-semibold text-slate-600">Cancel</button>}</div>
              {editing && !editing.is_archived && <button disabled={isPending} type="button" onClick={() => archive(editing)} className="w-full rounded-xl border border-red-200 px-4 py-2.5 text-sm font-semibold text-red-600 disabled:opacity-60">Archive product</button>}
            </form>
          </section>

          <section className="rounded-2xl border border-[var(--line)] bg-white p-5 shadow-sm sm:p-6">
            <h2 className="font-bold text-[var(--navy)]">Adjust stock</h2>
            <p className="mt-1 text-xs leading-5 text-slate-500">Record opening stock, new purchases, returns or corrections. Every adjustment is saved in the stock history.</p>
            <form onSubmit={submitStock} className="mt-5 space-y-3">
              <label className="block"><span className="mb-1.5 block text-xs font-semibold text-slate-600">Product *</span><select name="product_id" required value={stockProduct} onChange={(e) => setStockProduct(e.target.value)} className="w-full rounded-xl border border-[var(--line)] bg-white px-3.5 py-2.5 text-sm"><option value="">Choose a product</option>{activeProducts.filter((p) => p.track_inventory).map((p) => <option key={p.id} value={p.id}>{p.name} · {p.stock_on_hand ?? 0} in stock</option>)}</select></label>
              <div className="grid grid-cols-2 gap-3"><label className="block"><span className="mb-1.5 block text-xs font-semibold text-slate-600">Action</span><select name="direction" value={stockDirection} onChange={(e) => setStockDirection(e.target.value as "add" | "remove")} className="w-full rounded-xl border border-[var(--line)] bg-white px-3 py-2.5 text-sm"><option value="add">Add stock</option><option value="remove">Remove stock</option></select></label><label className="block"><span className="mb-1.5 block text-xs font-semibold text-slate-600">Quantity *</span><input name="quantity" type="number" min="1" max="999999" step="1" required value={stockQuantity} onChange={(e) => setStockQuantity(e.target.value)} className="w-full rounded-xl border border-[var(--line)] px-3 py-2.5 text-sm" /></label></div>
              <label className="block"><span className="mb-1.5 block text-xs font-semibold text-slate-600">Reason / note</span><input name="note" maxLength={300} value={stockNote} onChange={(e) => setStockNote(e.target.value)} placeholder="e.g. Opening stock or damaged item" className="w-full rounded-xl border border-[var(--line)] px-3.5 py-2.5 text-sm" /></label>
              {stockError && <p role="alert" className="rounded-xl bg-red-50 p-3 text-xs text-red-700">{stockError}</p>}
              <button disabled={isPending || activeProducts.filter((p) => p.track_inventory).length === 0} type="submit" className="w-full rounded-xl border border-[var(--navy)] px-4 py-3 text-sm font-bold text-[var(--navy)] disabled:opacity-50">{isPending ? "Recording..." : "Save stock adjustment"}</button>
            </form>
          </section>
        </div>
      </div>
    </div>
  );
}
