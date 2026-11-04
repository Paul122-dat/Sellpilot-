import Link from "next/link";
import { redirect } from "next/navigation";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import CustomerManager, { type CustomerRecord } from "./customer-manager";

export default async function CustomersPage() {
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

  const { data, error } = await supabase
    .from("customers")
    .select("id, name, phone_number, whatsapp_number, email, instagram_handle, delivery_address, notes, created_at")
    .eq("business_id", membership.business_id)
    .order("created_at", { ascending: false });

  if (error) {
    return <main className="min-h-screen bg-[var(--surface)] p-6"><p className="mx-auto max-w-3xl rounded-2xl bg-white p-6 text-sm text-slate-600">We couldn't load your customers. Please refresh and try again.</p></main>;
  }

  return (
    <main className="min-h-screen bg-[var(--surface)] px-4 py-6 sm:px-8">
      <div className="mx-auto max-w-5xl">
        <Link href="/" className="text-sm font-semibold text-[var(--orange)]">← Back to overview</Link>
        <div className="mt-5">
          <p className="text-sm font-medium text-[var(--orange)]">Workspace</p>
          <h1 className="mt-1 text-3xl font-bold tracking-tight text-[var(--navy)]">Customers</h1>
          <p className="mt-2 text-sm text-slate-500">Keep customer details organised in one secure business workspace.</p>
        </div>
        <div className="mt-7">
          <CustomerManager initialCustomers={(data ?? []) as CustomerRecord[]} />
        </div>
      </div>
    </main>
  );
}
