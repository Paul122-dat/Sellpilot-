"use client";

import { useActionState } from "react";
import { createBusiness, type AuthActionState } from "@/app/auth/actions";

const initialState: AuthActionState = {};

export default function BusinessSetupForm() {
  const [state, formAction, pending] = useActionState(createBusiness, initialState);

  return (
    <form action={formAction} className="mt-7 space-y-4">
      <label className="block">
        <span className="mb-1.5 block text-sm font-semibold text-slate-700">Business name</span>
        <input
          name="business_name"
          type="text"
          minLength={2}
          maxLength={120}
          autoComplete="organization"
          required
          placeholder="e.g. Ada's Fashion Store"
          className="w-full rounded-xl border border-slate-300 px-4 py-3 text-sm outline-none transition focus:border-[#F97316] focus:ring-2 focus:ring-orange-100"
        />
      </label>

      <div className="rounded-xl bg-slate-50 p-3 text-xs leading-5 text-slate-600">
        Your initial workspace will use Nigerian naira (NGN) and the Africa/Lagos time zone.
        You can review business settings as the app develops.
      </div>

      {state.error && (
        <p role="alert" className="rounded-xl border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
          {state.error}
        </p>
      )}

      <button
        type="submit"
        disabled={pending}
        className="w-full rounded-xl bg-[#F97316] px-4 py-3.5 text-sm font-bold text-white transition hover:bg-orange-600 disabled:cursor-not-allowed disabled:opacity-60"
      >
        {pending ? "Creating workspace..." : "Create workspace"}
      </button>
    </form>
  );
}
