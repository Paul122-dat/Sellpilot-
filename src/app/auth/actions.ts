"use server";

import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { createSupabaseServerClient } from "@/lib/supabase/server";

export type AuthActionState = {
  error?: string;
  success?: string;
};

function readText(formData: FormData, key: string) {
  return String(formData.get(key) ?? "").trim();
}

function validEmail(email: string) {
  const parts = email.split("@");
  if (parts.length !== 2) return false;
  const [localPart, domain] = parts;
  const lastDot = domain.lastIndexOf(".");
  return (
    localPart.length > 0 &&
    !email.includes(" ") &&
    lastDot > 0 &&
    lastDot < domain.length - 1
  );
}

export async function signUp(
  _previousState: AuthActionState,
  formData: FormData,
): Promise<AuthActionState> {
  const fullName = readText(formData, "full_name");
  const email = readText(formData, "email").toLowerCase();
  const password = String(formData.get("password") ?? "");

  if (fullName.length < 2 || fullName.length > 80) {
    return { error: "Enter your name (2 to 80 characters)." };
  }
  if (!validEmail(email)) {
    return { error: "Enter a valid email address." };
  }
  if (password.length < 8) {
    return { error: "Your password must contain at least 8 characters." };
  }

  const requestHeaders = await headers();
  const origin =
    requestHeaders.get("origin") ??
    process.env.NEXT_PUBLIC_SITE_URL ??
    "http://localhost:3000";

  let emailRedirectTo: string;
  try {
    const callback = new URL("/auth/callback", origin);
    callback.searchParams.set("next", "/onboarding");
    emailRedirectTo = callback.toString();
  } catch {
    return { error: "We couldn't prepare the email verification link. Please try again." };
  }

  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase.auth.signUp({
    email,
    password,
    options: {
      emailRedirectTo,
      data: { full_name: fullName },
    },
  });

  if (error) {
    return { error: error.message };
  }

  if (data.session) {
    redirect("/onboarding");
  }

  return {
    success:
      "Your account has been created. Check your email and confirm your address before signing in.",
  };
}

export async function signIn(
  _previousState: AuthActionState,
  formData: FormData,
): Promise<AuthActionState> {
  const email = readText(formData, "email").toLowerCase();
  const password = String(formData.get("password") ?? "");

  if (!validEmail(email) || !password) {
    return { error: "Enter your email address and password." };
  }

  const supabase = await createSupabaseServerClient();
  const { error } = await supabase.auth.signInWithPassword({
    email,
    password,
  });

  if (error) {
    return { error: "We couldn't sign you in. Check your email and password, then try again." };
  }

  redirect("/");
}

export async function signOut() {
  const supabase = await createSupabaseServerClient();
  await supabase.auth.signOut();
  redirect("/login");
}

export async function createBusiness(
  _previousState: AuthActionState,
  formData: FormData,
): Promise<AuthActionState> {
  const name = readText(formData, "business_name");

  if (name.length < 2 || name.length > 120) {
    return { error: "Enter a business name between 2 and 120 characters." };
  }

  const supabase = await createSupabaseServerClient();
  const { data: claimsData, error: claimsError } =
    await supabase.auth.getClaims();

  const userId = claimsData?.claims?.sub;
  if (claimsError || typeof userId !== "string") {
    redirect("/login");
  }

  const { data: memberships, error: membershipError } = await supabase
    .from("business_members")
    .select("business_id")
    .eq("user_id", userId)
    .limit(1);

  if (membershipError) {
    return { error: "We couldn't check your workspace access. Please try again." };
  }

  if (memberships && memberships.length > 0) {
    redirect("/");
  }

  // The database verifies owner_user_id with RLS and creates the owner's
  // business_members row through its on_business_created_add_owner trigger.
  const { error: insertError } = await supabase.from("businesses").insert({
    owner_user_id: userId,
    name,
    currency_code: "NGN",
    timezone: "Africa/Lagos",
  });

  if (insertError) {
    return { error: "We couldn't create your workspace. Please try again." };
  }

  redirect("/");
}
