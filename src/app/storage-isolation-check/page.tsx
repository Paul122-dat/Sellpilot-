import { redirect } from "next/navigation";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import StorageIsolationCheck from "./storage-isolation-check";

export default async function StorageIsolationPage() {
  const supabase = await createSupabaseServerClient();
  const { data: claimsData, error: claimsError } = await supabase.auth.getClaims();
  const userId = claimsData?.claims?.sub;
  if (claimsError || typeof userId !== "string") redirect("/login");

  const { data: membership } = await supabase
    .from("business_members")
    .select("business_id")
    .eq("user_id", userId)
    .limit(1)
    .maybeSingle();

  if (!membership?.business_id) redirect("/onboarding");

  const { data: products } = await supabase
    .from("products")
    .select("image_path")
    .eq("business_id", membership.business_id)
    .not("image_path", "is", null)
    .limit(20);

  const ownImagePaths = (products ?? [])
    .map((product) => product.image_path)
    .filter((path): path is string => typeof path === "string");

  return <StorageIsolationCheck ownImagePaths={ownImagePaths} />;
}
