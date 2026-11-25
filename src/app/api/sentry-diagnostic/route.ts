import { timingSafeEqual } from "node:crypto";
import * as Sentry from "@sentry/nextjs";
import { NextRequest, NextResponse } from "next/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function hasValidDiagnosticToken(request: NextRequest): boolean {
  if (process.env.VERCEL_ENV !== "preview") return false;

  const expected = process.env.SENTRY_PREVIEW_DIAGNOSTIC_TOKEN;
  const authorization = request.headers.get("authorization") ?? "";
  const supplied = authorization.startsWith("Bearer ")
    ? authorization.slice("Bearer ".length)
    : "";

  if (!expected || !supplied) return false;

  const expectedBytes = Buffer.from(expected, "utf8");
  const suppliedBytes = Buffer.from(supplied, "utf8");

  return (
    expectedBytes.length === suppliedBytes.length &&
    timingSafeEqual(expectedBytes, suppliedBytes)
  );
}

export async function POST(request: NextRequest) {
  if (!hasValidDiagnosticToken(request)) {
    return new NextResponse(null, {
      status: 404,
      headers: { "Cache-Control": "no-store" }
    });
  }

  let kind: unknown;

  try {
    const body = (await request.json()) as { kind?: unknown };
    kind = body.kind;
  } catch {
    return NextResponse.json(
      { error: "Invalid diagnostic request." },
      { status: 400, headers: { "Cache-Control": "no-store" } }
    );
  }

  if (kind === "browser") {
    // The client sends its own test exception only after this authorization succeeds.
    return new NextResponse(null, {
      status: 204,
      headers: { "Cache-Control": "no-store" }
    });
  }

  if (kind !== "server") {
    return NextResponse.json(
      { error: "Unsupported diagnostic type." },
      { status: 400, headers: { "Cache-Control": "no-store" } }
    );
  }

  Sentry.captureException(
    new Error("SellPilot Preview Sentry diagnostic: server event")
  );
  const flushed = await Sentry.flush(2000);

  return NextResponse.json(
    { accepted: true, flushed },
    { headers: { "Cache-Control": "no-store" } }
  );
}
