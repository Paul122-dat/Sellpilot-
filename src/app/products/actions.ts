"use server";

import { revalidatePath } from "next/cache";
import { createSupabaseServerClient } from "@/lib/supabase/server";

export type ProductActionResult = { error?: string };

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

function readMoney(formData: FormData, key: string, required: boolean) {
  const raw = String(formData.get(key) ?? "").trim();
  if (!raw && !required) return { value: null as number | null };
  if (!raw || !/^\d{1,12}(\.\d{1,2})?$/.test(raw)) return { error: "Enter a valid amount with up to two decimal places." };
  const value = Number(raw);
  if (!Number.isFinite(value) || value < 0 || value > 999999999999.99) return { error: "Enter a valid amount." };
  return { value };
}

function validateProduct(formData: FormData) {
  const name = readText(formData, "name", 160);
  const sku = readText(formData, "sku", 80);
  const description = readText(formData, "description", 2000);
  const selling = readMoney(formData, "selling_price", true);
  const cost = readMoney(formData, "cost_price", false);
  const thresholdRaw = String(formData.get("low_stock_threshold") ?? "5").trim();
  const threshold = Number(thresholdRaw);
  const trackInventory = formData.get("track_inventory") === "on";

  if (!name) return { error: "Enter a product name." } as const;
  if ("error" in selling) return selling;
  if ("error" in cost) return cost;
  if (!/^\d{1,6}$/.test(thresholdRaw) || !Number.isSafeInteger(threshold) || threshold < 0) {
    return { error: "Enter a whole-number low-stock threshold (0 or more)." } as const;
  }

  return {
    values: {
      name,
      sku,
      description,
      selling_price: selling.value!,
      cost_price: cost.value,
      track_inventory: trackInventory,
      low_stock_threshold: threshold,
    },
  } as const;
}

export async function createProduct(formData: FormData): Promise<ProductActionResult> {
  const validated = validateProduct(formData);
  if ("error" in validated) return validated;
  const workspace = await getAuthorizedWorkspace();
  if ("error" in workspace) return workspace;

  const { error } = await workspace.supabase.from("products").insert({
    ...validated.values,
    business_id: workspace.businessId,
    created_by: workspace.userId,
  });

  if (error) {
    if (error.code === "23505") return { error: "That SKU is already used by another product." };
    return { error: "We couldn't save this product. Check the details and try again." };
  }

  revalidatePath("/products");
  revalidatePath("/");
  return {};
}

export async function updateProduct(productId: string, formData: FormData): Promise<ProductActionResult> {
  if (!/^[0-9a-f-]{36}$/i.test(productId)) return { error: "That product record is not valid." };
  const validated = validateProduct(formData);
  if ("error" in validated) return validated;
  const workspace = await getAuthorizedWorkspace();
  if ("error" in workspace) return workspace;

  const { data, error } = await workspace.supabase
    .from("products")
    .update(validated.values)
    .eq("id", productId)
    .eq("business_id", workspace.businessId)
    .select("id")
    .maybeSingle();

  if (error) {
    if (error.code === "23505") return { error: "That SKU is already used by another product." };
    return { error: "We couldn't update this product. Refresh and try again." };
  }
  if (!data) return { error: "We couldn't find that product in your workspace." };

  revalidatePath("/products");
  revalidatePath("/");
  return {};
}

export async function archiveProduct(productId: string): Promise<ProductActionResult> {
  if (!/^[0-9a-f-]{36}$/i.test(productId)) return { error: "That product record is not valid." };
  const workspace = await getAuthorizedWorkspace();
  if ("error" in workspace) return workspace;

  const { data, error } = await workspace.supabase
    .from("products")
    .update({ is_archived: true })
    .eq("id", productId)
    .eq("business_id", workspace.businessId)
    .select("id")
    .maybeSingle();

  if (error || !data) return { error: "We couldn't archive this product. Refresh and try again." };
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
  if (direction !== "add" && direction !== "remove") return { error: "Choose whether to add or remove stock." };
  if (!/^\d{1,6}$/.test(quantityRaw) || Number(quantityRaw) < 1) return { error: "Enter a whole quantity greater than zero." };

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
    if (error.message?.includes("negative")) return { error: "There isn't enough stock for that reduction." };
    if (error.message?.includes("does not have tracked inventory")) return { error: "Inventory tracking is turned off for this product." };
    return { error: "We couldn't record this stock adjustment. Check the product and quantity." };
  }

  revalidatePath("/products");
  revalidatePath("/");
  return {};
}
