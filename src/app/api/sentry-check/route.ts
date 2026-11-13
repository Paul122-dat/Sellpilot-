import { NextResponse } from "next/server";

export const runtime = "nodejs";

export async function POST() {
  if (process.env.VERCEL_ENV === "production") {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  throw new Error("SellPilot Sentry preview smoke test");
}
