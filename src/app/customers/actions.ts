"use server";

import { revalidatePath } from "next/cache";
import { createSupabaseServerClient } from "@/lib/supabase/server";

export type CustomerActionResult = { error?: string };

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

function read(formData: FormData, key: string, max: number) {
  const value = String(formData.get(key) ?? "").trim();
  return value ? value.slice(0, max) : null;
}

function validateCustomer(formData: FormData) {
  const name = read(formData, "name", 160);
  const phoneNumber = read(formData, "phone_number", 40);
  const whatsappNumber = read(formData, "whatsapp_number", 40);
  const email = read(formData, "email", 254);
  const instagramHandle = read(formData, "instagram_handle", 80);
  const deliveryAddress = read(formData, "delivery_address", 500);
  const notes = read(formData, "notes", 2000);

  if (!name || name.length < 1) return { error: "Enter the customer's name." } as const;
  if (email && (!email.includes("@") || email.startsWith("@") || email.endsWith("@"))) {
    return { error: "Enter a valid email address or leave it blank." } as const;
  }

  return {
    values: {
      name,
      phone_number: phoneNumber,
      whatsapp_number: whatsappNumber,
      email,
      instagram_handle: instagramHandle,
      delivery_address: deliveryAddress,
      notes,
    },
  } as const;
}

export async function createCustomer(formData: FormData): Promise<CustomerActionResult> {
  const validated = validateCustomer(formData);
  if ("error" in validated) return validated;

  const workspace = await getAuthorizedWorkspace();
  if ("error" in workspace) return workspace;

  const { error } = await workspace.supabase.from("customers").insert({
    ...validated.values,
    business_id: workspace.businessId,
    created_by: workspace.userId,
  });

  if (error) {
    return { error: "We couldn't save this customer. Please check the details and try again." };
  }

  revalidatePath("/customers");
  revalidatePath("/");
  return {};
}

export async function updateCustomer(
  customerId: string,
  formData: FormData,
): Promise<CustomerActionResult> {
  if (!/^[0-9a-f-]{36}$/i.test(customerId)) {
    return { error: "That customer record is not valid." };
  }

  const validated = validateCustomer(formData);
  if ("error" in validated) return validated;

  const workspace = await getAuthorizedWorkspace();
  if ("error" in workspace) return workspace;

  const { data, error } = await workspace.supabase
    .from("customers")
    .update(validated.values)
    .eq("id", customerId)
    .eq("business_id", workspace.businessId)
    .select("id")
    .maybeSingle();

  if (error || !data) {
    return { error: "We couldn't update this customer. Refresh and try again." };
  }

  revalidatePath("/customers");
  revalidatePath("/");
  return {};
}
