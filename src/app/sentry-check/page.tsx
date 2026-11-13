import { notFound } from "next/navigation";
import SentryCheckClient from "./SentryCheckClient";

export default function SentryCheckPage() {
  if (process.env.VERCEL_ENV === "production") {
    notFound();
  }

  return <SentryCheckClient />;
}
