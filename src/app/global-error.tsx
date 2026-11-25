"use client";

import * as Sentry from "@sentry/nextjs";
import { useEffect } from "react";

export default function GlobalError({
  error,
  reset
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    Sentry.captureException(error);
  }, [error]);

  return (
    <html lang="en">
      <body>
        <main
          style={{
            minHeight: "100vh",
            display: "grid",
            placeItems: "center",
            padding: "24px",
            background: "#FFFFFF",
            color: "#1E293B",
            fontFamily: "Arial, sans-serif"
          }}
        >
          <section style={{ width: "100%", maxWidth: "440px", textAlign: "center" }}>
            <p style={{ marginBottom: "12px", color: "#1E293B", fontWeight: 700, letterSpacing: "0.12em" }}>
              SELLPILOT
            </p>
            <h1 style={{ margin: "0 0 12px", fontSize: "28px", lineHeight: 1.2 }}>
              Something went wrong
            </h1>
            <p style={{ margin: "0 0 24px", color: "#475569", lineHeight: 1.6 }}>
              An unexpected error interrupted this screen. Please try again.
            </p>
            <button
              type="button"
              onClick={() => reset()}
              style={{
                border: 0,
                borderRadius: "10px",
                padding: "12px 20px",
                background: "#F97316",
                color: "#FFFFFF",
                fontWeight: 700,
                cursor: "pointer"
              }}
            >
              Try again
            </button>
          </section>
        </main>
      </body>
    </html>
  );
}
