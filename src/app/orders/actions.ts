"use server";

import { revalidatePath } from "next/cache";
import { createSupabaseServerClient } from "@/lib/supabase/server";

export type OrderActionResult = {
  error?: string;
  orderId?: string;
};

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const PAYMENT_METHODS = ["cash", "bank_transfer", "card", "online", "other"] as const;
const SALES_CHANNELS = ["whatsapp", "instagram", "in_person", "other"] as const;
const ORDER_STATUSES = ["confirmed", "processing", "ready", "dispatched", "delivered", "cancelled"] as const;

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

function textValue(formData: FormData, key: string, max: number) {
  const value = String(formData.get(key) ?? "").trim();
  return value ? value.slice(0, max) : null;
}

function moneyValue(formData: FormData, key: string): number | null {
  const raw = String(formData.get(key) ?? "").trim();
  if (!raw) return 0;
  if (!/^\d{1,12}(\.\d{1,2})?$/.test(raw)) return null;
  const value = Number(raw);
  return Number.isFinite(value) && value >= 0 && value <= 999999999999.99 ? value : null;
}

function validDate(value: string | null) {
  if (!value) return true;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const parsed = new Date(value + "T00:00:00.000Z");
  return !Number.isNaN(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value;
}

export async function createOrder(formData: FormData): Promise<OrderActionResult> {
  const workspace = await getAuthorizedWorkspace();
  if ("error" in workspace) return workspace;

  const customerId = textValue(formData, "customer_id", 36);
  const customerName = textValue(formData, "customer_name", 160);
  const customerPhone = textValue(formData, "customer_phone", 40);
  const salesChannel = String(formData.get("sales_channel") ?? "other");
  const expectedDate = textValue(formData, "expected_delivery_date", 10);
  const deliveryAddress = textValue(formData, "delivery_address", 1000);
  const notes = textValue(formData, "notes", 2000);
  const discountAmount = moneyValue(formData, "discount_amount");
  const deliveryFee = moneyValue(formData, "delivery_fee");
  const initialPaymentAmount = moneyValue(formData, "initial_payment_amount");
  const paymentMethod = String(formData.get("initial_payment_method") ?? "");

  if (customerId && !UUID_PATTERN.test(customerId)) {
    return { error: "Choose a valid customer." };
  }
  if (!customerId && !customerName) {
    return { error: "Enter the customer's name or select an existing customer." };
  }
  if (!(SALES_CHANNELS as readonly string[]).includes(salesChannel)) {
    return { error: "Choose a valid sales channel." };
  }
  if (!validDate(expectedDate)) {
    return { error: "Enter a valid expected delivery date." };
  }
  if (discountAmount === null || deliveryFee === null || initialPaymentAmount === null) {
    return { error: "Enter valid amounts using up to two decimal places." };
  }
  if (initialPaymentAmount > 0 && !(PAYMENT_METHODS as readonly string[]).includes(paymentMethod)) {
    return { error: "Choose a payment method for the initial payment." };
  }

  let items: { product_id: string; quantity: number }[];
  try {
    const parsed: unknown = JSON.parse(String(formData.get("items") ?? "[]"));
    if (!Array.isArray(parsed) || parsed.length < 1 || parsed.length > 50) {
      return { error: "Add at least one product to the order." };
    }

    items = [];
    for (const item of parsed) {
      if (
        !item ||
        typeof item !== "object" ||
        !("product_id" in item) ||
        !("quantity" in item) ||
        typeof item.product_id !== "string" ||
        !UUID_PATTERN.test(item.product_id) ||
        !Number.isSafeInteger(item.quantity) ||
        item.quantity < 1 ||
        item.quantity > 999999
      ) {
        return { error: "One of the order items is invalid. Check the products and quantities." };
      }
      items.push({ product_id: item.product_id, quantity: item.quantity });
    }
  } catch {
    return { error: "The order items could not be read. Please try again." };
  }

  const { data, error } = await workspace.supabase.rpc("create_order", {
    p_business_id: workspace.businessId,
    p_customer_id: customerId || null,
    p_customer_name: customerName,
    p_customer_phone: customerPhone,
    p_sales_channel: salesChannel,
    p_items: items,
    p_discount_amount: discountAmount,
    p_delivery_fee: deliveryFee,
    p_expected_delivery_date: expectedDate,
    p_delivery_address: deliveryAddress,
    p_notes: notes,
    p_initial_payment_amount: initialPaymentAmount,
    p_initial_payment_method: initialPaymentAmount > 0 ? paymentMethod : null,
    p_initial_payment_reference: textValue(formData, "initial_payment_reference", 160),
    p_initial_payment_note: textValue(formData, "initial_payment_note", 500),
  });

  if (error || typeof data !== "string") {
    const message = error?.message ?? "";
    if (message.includes("SKU") || message.includes("reference")) {
      return { error: "That payment reference already exists. Check the reference and try again." };
    }
    return { error: message.includes("Discount") || message.includes("customer") || message.includes("product") || message.includes("payment")
      ? message
      : "We couldn't create this order. Check the details and try again." };
  }

  revalidatePath("/orders");
  revalidatePath("/products");
  revalidatePath("/");
  return { orderId: data };
}

export async function advanceOrderStatus(
  orderId: string,
  nextStatus: string,
): Promise<OrderActionResult> {
  if (!UUID_PATTERN.test(orderId) || !(ORDER_STATUSES as readonly string[]).includes(nextStatus)) {
    return { error: "That order update is not valid." };
  }

  const workspace = await getAuthorizedWorkspace();
  if ("error" in workspace) return workspace;

  const { data, error } = await workspace.supabase
    .from("orders")
    .update({ order_status: nextStatus })
    .eq("id", orderId)
    .eq("business_id", workspace.businessId)
    .select("id")
    .maybeSingle();

  if (error || !data) {
    const message = error?.message ?? "";
    if (message.includes("Insufficient stock")) {
      return { error: "Not enough stock is available. Add stock or reduce the order quantity before confirming." };
    }
    if (message.includes("archived")) {
      return { error: "A product in this order is archived. Restore it before confirming the order." };
    }
    return { error: "We couldn't update this order. It may already be complete or may need refreshing." };
  }

  revalidatePath("/orders");
  revalidatePath("/products");
  revalidatePath("/");
  return {};
}

export async function recordOrderTransaction(formData: FormData): Promise<OrderActionResult> {
  const orderId = textValue(formData, "order_id", 36);
  const transactionType = String(formData.get("transaction_type") ?? "payment");
  const amount = moneyValue(formData, "amount");
  const method = String(formData.get("payment_method") ?? "other");

  if (!orderId || !UUID_PATTERN.test(orderId)) return { error: "Choose a valid order." };
  if (transactionType !== "payment" && transactionType !== "refund") {
    return { error: "Choose a valid transaction type." };
  }
  if (amount === null || amount <= 0) return { error: "Enter an amount greater than zero." };
  if (!(PAYMENT_METHODS as readonly string[]).includes(method)) {
    return { error: "Choose a valid payment method." };
  }

  const workspace = await getAuthorizedWorkspace();
  if ("error" in workspace) return workspace;

  const { data: order, error: orderError } = await workspace.supabase
    .from("orders")
    .select("id, order_status")
    .eq("id", orderId)
    .eq("business_id", workspace.businessId)
    .maybeSingle();

  if (orderError || !order) return { error: "We couldn't find that order in your workspace." };
  if (transactionType === "payment" && order.order_status === "cancelled") {
    return { error: "A cancelled order cannot accept another payment. Record a refund instead." };
  }

  const { error } = await workspace.supabase.from("payments").insert({
    business_id: workspace.businessId,
    order_id: orderId,
    transaction_type: transactionType,
    amount,
    payment_method: method,
    reference: textValue(formData, "reference", 160),
    note: textValue(formData, "note", 500),
    recorded_by: workspace.userId,
  });

  if (error) {
    const message = error.message ?? "";
    if (message.includes("refund")) return { error: "A refund cannot be greater than the amount still received." };
    if (error.code === "23505") return { error: "That payment reference already exists for this payment method." };
    return { error: "We couldn't record this transaction. Check the amount and try again." };
  }

  revalidatePath("/orders");
  revalidatePath("/");
  return {};
}
