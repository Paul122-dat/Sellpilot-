import { redirect } from "next/navigation";
import BusinessSetupForm from "@/app/business-setup-form";
import { createSupabaseServerClient } from "@/lib/supabase/server";

export default async function OnboardingPage() {
  const supabase = await createSupabaseServerClient();
  const { data: claimsData, error: claimsError } = await supabase.auth.getClaims();
  const userId = claimsData?.claims?.sub;

  if (claimsError || typeof userId !== "string") {
    redirect("/login");
  }

  const { data: memberships, error } = await supabase
    .from("business_members")
    .select("business_id")
    .eq("user_id", userId)
    .limit(1);

  if (error) {
    return (
      <main className="flex min-h-screen items-center justify-center bg-slate-50 px-4">
        <section className="w-full max-w-md rounded-3xl border border-slate-200 bg-white p-6 text-center shadow-sm">
          <h1 className="text-xl font-bold text-[#1E293B]">We couldn't load your workspace</h1>
          <p className="mt-2 text-sm leading-6 text-slate-500">
            Please refresh this page. Your account has not been changed.
          </p>
        </section>
      </main>
    );
  }

  if (memberships && memberships.length > 0) {
    redirect("/");
  }

  return (
    <main className="flex min-h-screen items-center justify-center bg-slate-50 px-4 py-10">
      <section className="w-full max-w-md rounded-3xl border border-slate-200 bg-white p-6 shadow-sm sm:p-8">
        <a href="/" className="text-2xl font-black tracking-tight text-[#1E293B]">
          Sell<span className="text-[#F97316]">Pilot</span>
        </a>
        <p className="mt-2 text-sm text-slate-500">One workspace for your business.</p>
        <h1 className="mt-8 text-2xl font-bold text-[#1E293B]">Set up your business</h1>
        <p className="mt-2 text-sm leading-6 text-slate-500">
          Add the business name you use to sell through WhatsApp, Instagram or other channels.
        </p>
        <BusinessSetupForm />
      </section>
    </main>
  );
}
