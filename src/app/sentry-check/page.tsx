import { notFound } from "next/navigation";
import SentryDiagnosticClient from "./sentry-diagnostic-client";

export const dynamic = "force-dynamic";
// Rebuild after the branch-scoped Preview diagnostic secret was configured.

export default function SentryCheckPage() {
  if (
    process.env.VERCEL_ENV !== "preview" ||
    !process.env.SENTRY_PREVIEW_DIAGNOSTIC_TOKEN
  ) {
    notFound();
  }

  return <SentryDiagnosticClient />;
}
