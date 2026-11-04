"use server";

import { revalidatePath } from "next/cache";
import { createSupabaseServerClient } from "@/lib/supabase/server";

const IMAGE_BUCKET = "product-images";

export type ProductActionResult = {
  error?: string;
  productId?: string;
};

type ValidationResult<T> =
  | { ok: true; value: T }
  | { ok: false; error: string };

type ProductValues = {
  name: string;
  sku: string | null;
  description: string | null;
  selling_price: number;
  cost_price: number | null;
  track_inventory: boolean;
  low_stock_threshold: number;
};

async function getAuthorizedWorkspace() {
  const supabase = await createSupabaseServerClient();
  const { data: claimsData, error: claimsError } = await supabase.auth.getClaims();
  const userId = claimsData?.claims?.sub;

  if (claimsError || typeof userId !== "string") {
    return { error: "Your session has expired. Please sign in again." } as const;
  }

  const { data: membership, error } = await supabase
    .from("business_members")
    .select("business_id")
    .eq("user_id", userId)
    .limit(1)
    .maybeSingle();

  if (error || !membership?.business_id) {
    return { error: "We couldn't verify your business workspace." } as const;
  }

  return { supabase, userId, businessId: membership.business_id } as const;
}

function readText(formData: FormData, key: string, max: number) {
  const value = String(formData.get(key) ?? "").trim();
  return value ? value.slice(0, max) : null;
}

function readMoney(
  formData: FormData,
  key: string,
  required: boolean,
): ValidationResult<number | null> {
  const raw = String(formData.get(key) ?? "").trim();
  if (!raw && !required) return { ok: true, value: null };
  if (!raw || !/^\d{1,12}(\.\d{1,2})?$/.test(raw)) {
    return { ok: false, error: "Enter a valid amount with up to two decimal places." };
  }

  const value = Number(raw);
  if (!Number.isFinite(value) || value < 0 || value > 999999999999.99) {
    return { ok: false, error: "Enter a valid amount." };
  }
  return { ok: true, value };
}

function validateProduct(formData: FormData): ValidationResult<ProductValues> {
  const name = readText(formData, "name", 160);
  const sku = readText(formData, "sku", 80);
  const description = readText(formData, "description", 2000);
  const selling = readMoney(formData, "selling_price", true);
  const cost = readMoney(formData, "cost_price", false);
  const thresholdRaw = String(formData.get("low_stock_threshold") ?? "5").trim();
  const threshold = Number(thresholdRaw);
  const trackInventory = formData.get("track_inventory") === "on";

  if (!name) return { ok: false, error: "Enter a product name." };
  if (!selling.ok) return selling;
  if (selling.value === null) {
    return { ok: false, error: "Enter a valid selling price." };
  }
  if (!cost.ok) return cost;
  if (!/^\d{1,6}$/.test(thresholdRaw) || !Number.isSafeInteger(threshold) || threshold < 0) {
    return { ok: false, error: "Enter a whole-number low-stock threshold (0 or more)." };
  }

  return {
    ok: true,
    value: {
      name,
      sku,
      description,
      selling_price: selling.value,
      cost_price: cost.value,
      track_inventory: trackInventory,
      low_stock_threshold: threshold,
    },
  };
}

export async function createProduct(formData: FormData): Promise<ProductActionResult> {
  const validation = validateProduct(formData);
  if (!validation.ok) return { error: validation.error };

  const workspace = await getAuthorizedWorkspace();
  if ("error" in workspace) return workspace;

  const productId = crypto.randomUUID();
  const { error } = await workspace.supabase.from("products").insert({
    id: productId,
    ...validation.value,
    image_path: null,
    business_id: workspace.businessId,
    created_by: workspace.userId,
  });

  if (error) {
    if (error.code === "23505") return { error: "That SKU is already used by another product." };
    return { error: "We couldn't save this product. Check the details and try again." };
  }

  revalidatePath("/products");
  revalidatePath("/");
  return { productId };
}

export async function updateProduct(
  productId: string,
  formData: FormData,
): Promise<ProductActionResult> {
  if (!/^[0-9a-f-]{36}$/i.test(productId)) {
    return { error: "That product record is not valid." };
  }

  const validation = validateProduct(formData);
  if (!validation.ok) return { error: validation.error };

  const workspace = await getAuthorizedWorkspace();
  if ("error" in workspace) return workspace;

  const { data, error } = await workspace.supabase
    .from("products")
    .update(validation.value)
    .eq("id", productId)
    .eq("business_id", workspace.businessId)
    .select("id")
    .maybeSingle();

  if (error || !data) {
    if (error?.code === "23505") {
      return { error: "That SKU is already used by another product." };
    }
    return { error: "We couldn't update this product. Refresh and try again." };
  }

  revalidatePath("/products");
  revalidatePath("/");
  return { productId };
}

/**
 * Links an image that the signed-in browser has already uploaded directly to
 * the private Storage bucket. The object key is constrained to this workspace
 * and product, and Storage is checked before the database path is changed.
 */
export async function attachProductImage(
  productId: string,
  imagePath: string,
): Promise<ProductActionResult> {
  if (!/^[0-9a-f-]{36}$/i.test(productId)) {
    return { error: "That product record is not valid." };
  }

  const workspace = await getAuthorizedWorkspace();
  if ("error" in workspace) return workspace;

  const prefix = workspace.businessId + "/" + productId + "/";
  if (!imagePath.startsWith(prefix)) {
    return { error: "That product photo does not belong to this workspace." };
  }

  const fileName = imagePath.slice(prefix.length);
  if (!/^[0-9a-f-]{36}\.(jpg|png|webp)$/i.test(fileName)) {
    return { error: "That product photo file is not valid." };
  }

  const { data: existing, error: readError } = await workspace.supabase
    .from("products")
    .select("image_path")
    .eq("id", productId)
    .eq("business_id", workspace.businessId)
    .maybeSingle();

  if (readError || !existing) {
    return { error: "We couldn't find that product in your workspace." };
  }

  const { data: objects, error: storageError } = await workspace.supabase.storage
    .from(IMAGE_BUCKET)
    .list(workspace.businessId + "/" + productId, { limit: 100, search: fileName });

  if (storageError || !objects?.some((object) => object.name === fileName)) {
    return { error: "We couldn't verify the uploaded photo. Please try again." };
  }

  const { data, error } = await workspace.supabase
    .from("products")
    .update({ image_path: imagePath })
    .eq("id", productId)
    .eq("business_id", workspace.businessId)
    .select("id")
    .maybeSingle();

  if (error || !data) {
    return { error: "The photo uploaded, but we couldn't attach it to the product." };
  }

  if (existing.image_path && existing.image_path !== imagePath) {
    const { error: deleteError } = await workspace.supabase.storage
      .from(IMAGE_BUCKET)
      .remove([existing.image_path]);
    if (deleteError) {
      console.error("SellPilot could not remove a replaced product photo.", {
        productId,
        statusCode: deleteError.statusCode,
      });
    }
  }

  revalidatePath("/products");
  revalidatePath("/");
  return { productId };
}

export async function archiveProduct(productId: string): Promise<ProductActionResult> {
  if (!/^[0-9a-f-]{36}$/i.test(productId)) {
    return { error: "That product record is not valid." };
  }

  const workspace = await getAuthorizedWorkspace();
  if ("error" in workspace) return workspace;

  const { data, error } = await workspace.supabase
    .from("products")
    .update({ is_archived: true })
    .eq("id", productId)
    .eq("business_id", workspace.businessId)
    .select("id")
    .maybeSingle();

  if (error || !data) {
    return { error: "We couldn't archive this product. Refresh and try again." };
  }

  revalidatePath("/products");
  revalidatePath("/");
  return {};
}

export async function recordStockAdjustment(formData: FormData): Promise<ProductActionResult> {
  const productId = String(formData.get("product_id") ?? "").trim();
  const direction = String(formData.get("direction") ?? "");
  const quantityRaw = String(formData.get("quantity") ?? "").trim();
  const note = readText(formData, "note", 300);

  if (!/^[0-9a-f-]{36}$/i.test(productId)) return { error: "Choose a valid product." };
  if (direction !== "add" && direction !== "remove") {
    return { error: "Choose whether to add or remove stock." };
  }
  if (!/^\d{1,6}$/.test(quantityRaw) || Number(quantityRaw) < 1) {
    return { error: "Enter a whole quantity greater than zero." };
  }

  const quantity = Number(quantityRaw) * (direction === "add" ? 1 : -1);
  const workspace = await getAuthorizedWorkspace();
  if ("error" in workspace) return workspace;

  const { error } = await workspace.supabase.from("stock_movements").insert({
    business_id: workspace.businessId,
    product_id: productId,
    movement_type: "adjustment",
    quantity_change: quantity,
    note,
    created_by: workspace.userId,
  });

  if (error) {
    if (error.message?.includes("negative")) {
      return { error: "There isn't enough stock for that reduction." };
    }
    if (error.message?.includes("does not have tracked inventory")) {
      return { error: "Inventory tracking is turned off for this product." };
    }
    return { error: "We couldn't record this stock adjustment. Check the product and quantity." };
  }

  revalidatePath("/products");
  revalidatePath("/");
  return {};
}
