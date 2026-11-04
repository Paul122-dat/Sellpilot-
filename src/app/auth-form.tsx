"use client";

import Link from "next/link";
import { useActionState } from "react";
import { signIn, signUp, type AuthActionState } from "@/app/auth/actions";

type Props = {
  mode: "login" | "signup";
};

const initialState: AuthActionState = {};

export default function AuthForm({ mode }: Props) {
  const isSignup = mode === "signup";
  const action = isSignup ? signUp : signIn;
  const [state, formAction, pending] = useActionState(action, initialState);

  return (
    <main className="flex min-h-screen items-center justify-center bg-slate-50 px-4 py-10">
      <section className="w-full max-w-md rounded-3xl border border-slate-200 bg-white p-6 shadow-sm sm:p-8">
        <a href="/" className="text-2xl font-black tracking-tight text-[#1E293B]">
          Sell<span className="text-[#F97316]">Pilot</span>
        </a>
        <p className="mt-2 text-sm text-slate-500">Your business, in control.</p>

        <div className="mt-8">
          <h1 className="text-2xl font-bold text-[#1E293B]">
            {isSignup ? "Create your account" : "Welcome back"}
          </h1>
          <p className="mt-2 text-sm leading-6 text-slate-500">
            {isSignup
              ? "Create a secure account to set up your SellPilot workspace."
              : "Sign in to continue to your business workspace."}
          </p>
        </div>

        <form action={formAction} className="mt-7 space-y-4">
          {isSignup && (
            <label className="block">
              <span className="mb-1.5 block text-sm font-semibold text-slate-700">Full name</span>
              <input
                name="full_name"
                type="text"
                autoComplete="name"
                minLength={2}
                maxLength={80}
                required
                className="w-full rounded-xl border border-slate-300 px-4 py-3 text-sm outline-none transition focus:border-[#F97316] focus:ring-2 focus:ring-orange-100"
                placeholder="Your full name"
              />
            </label>
          )}

          <label className="block">
            <span className="mb-1.5 block text-sm font-semibold text-slate-700">Email address</span>
            <input
              name="email"
              type="email"
              autoComplete="email"
              required
              className="w-full rounded-xl border border-slate-300 px-4 py-3 text-sm outline-none transition focus:border-[#F97316] focus:ring-2 focus:ring-orange-100"
              placeholder="you@example.com"
            />
          </label>

          <label className="block">
            <span className="mb-1.5 block text-sm font-semibold text-slate-700">Password</span>
            <input
              name="password"
              type="password"
              autoComplete={isSignup ? "new-password" : "current-password"}
              minLength={isSignup ? 8 : undefined}
              required
              className="w-full rounded-xl border border-slate-300 px-4 py-3 text-sm outline-none transition focus:border-[#F97316] focus:ring-2 focus:ring-orange-100"
              placeholder={isSignup ? "At least 8 characters" : "Your password"}
            />
          </label>

          {state.error && (
            <p role="alert" className="rounded-xl border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
              {state.error}
            </p>
          )}
          {state.success && (
            <p role="status" className="rounded-xl border border-green-200 bg-green-50 px-3 py-2 text-sm text-green-800">
              {state.success}
            </p>
          )}

          <button
            type="submit"
            disabled={pending}
            className="w-full rounded-xl bg-[#F97316] px-4 py-3.5 text-sm font-bold text-white transition hover:bg-orange-600 disabled:cursor-not-allowed disabled:opacity-60"
          >
            {pending ? "Please wait..." : isSignup ? "Create account" : "Sign in"}
          </button>
        </form>

        <p className="mt-6 text-center text-sm text-slate-500">
          {isSignup ? "Already have an account?" : "New to SellPilot?"}{" "}
          <Link
            href={isSignup ? "/login" : "/signup"}
            className="font-bold text-[#F97316] hover:underline"
          >
            {isSignup ? "Sign in" : "Create an account"}
          </Link>
        </p>
      </section>
    </main>
  );
}
