import { redirect } from "next/navigation";
import DashboardClient from "@/app/dashboard-client";
import { createSupabaseServerClient } from "@/lib/supabase/server";

export default async function HomePage() {
  const supabase = await createSupabaseServerClient();
  const { data: claimsData, error: claimsError } = await supabase.auth.getClaims();
  const userId = claimsData?.claims?.sub;

  // Never authorize dashboard access using an unverified session cookie.
  if (claimsError || typeof userId !== "string") {
    redirect("/login");
  }

  const { data: memberships, error: membershipError } = await supabase
    .from("business_members")
    .select("business_id")
    .eq("user_id", userId)
    .limit(1);

  if (membershipError) {
    return (
      <main className="flex min-h-screen items-center justify-center bg-slate-50 px-4">
        <section className="w-full max-w-md rounded-3xl border border-slate-200 bg-white p-6 text-center shadow-sm">
          <h1 className="text-xl font-bold text-[#1E293B]">We couldn't verify your workspace</h1>
          <p className="mt-2 text-sm leading-6 text-slate-500">
            Please refresh this page. Your business information has not been changed.
          </p>
        </section>
      </main>
    );
  }

  if (!memberships || memberships.length === 0) {
    redirect("/onboarding");
  }

  const { data: profile } = await supabase
    .from("profiles")
    .select("full_name")
    .eq("id", userId)
    .maybeSingle();

  return <DashboardClient userName={profile?.full_name ?? ""} />;
}
