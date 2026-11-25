"use client";

import * as Sentry from "@sentry/nextjs";
import { useState } from "react";

type DiagnosticKind = "browser" | "server";

export default function SentryDiagnosticClient() {
  const [token, setToken] = useState("");
  const [busy, setBusy] = useState<DiagnosticKind | null>(null);
  const [message, setMessage] = useState("");

  async function runDiagnostic(kind: DiagnosticKind) {
    if (!token.trim()) {
      setMessage("Enter the temporary Preview test token first.");
      return;
    }

    setBusy(kind);
    setMessage("");

    try {
      const response = await fetch("/api/sentry-diagnostic", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token.trim()}`
        },
        body: JSON.stringify({ kind }),
        cache: "no-store"
      });

      if (!response.ok) {
        setMessage("The test was not authorized. Check the Preview test token.");
        return;
      }

      if (kind === "browser") {
        Sentry.captureException(
          new Error("SellPilot Preview Sentry diagnostic: browser event")
        );
        const flushed = await Sentry.flush(2000);
        setMessage(
          flushed
            ? "Browser diagnostic submitted to Sentry. Check the Preview environment in Sentry."
            : "Browser diagnostic was queued, but Sentry did not confirm the flush."
        );
      } else {
        const result = (await response.json()) as { flushed?: boolean };
        setMessage(
          result.flushed
            ? "Server diagnostic submitted to Sentry. Check the Preview environment in Sentry."
            : "Server diagnostic was captured locally, but Sentry did not confirm the flush."
        );
      }
    } catch {
      setMessage("The diagnostic request failed. Check the Preview deployment and try again.");
    } finally {
      setBusy(null);
    }
  }

  return (
    <main
      style={{
        minHeight: "100vh",
        display: "grid",
        placeItems: "center",
        padding: "24px",
        background: "#F8FAFC",
        color: "#1E293B",
        fontFamily: "Arial, sans-serif"
      }}
    >
      <section
        aria-labelledby="sentry-check-title"
        style={{
          width: "100%",
          maxWidth: "480px",
          padding: "28px",
          border: "1px solid #E2E8F0",
          borderRadius: "16px",
          background: "#FFFFFF",
          boxShadow: "0 12px 32px rgba(30, 41, 59, 0.08)"
        }}
      >
        <p style={{ margin: "0 0 8px", color: "#F97316", fontWeight: 700 }}>
          SELLPILOT · PREVIEW ONLY
        </p>
        <h1 id="sentry-check-title" style={{ margin: "0 0 10px", fontSize: "24px" }}>
          Sentry diagnostic
        </h1>
        <p style={{ color: "#475569", lineHeight: 1.6 }}>
          Use this temporary page to check browser and server error reporting.
          It does not create or change business data.
        </p>

        <label
          htmlFor="diagnostic-token"
          style={{ display: "block", margin: "22px 0 8px", fontWeight: 700 }}
        >
          Temporary Preview test token
        </label>
        <input
          id="diagnostic-token"
          type="password"
          autoComplete="off"
          spellCheck={false}
          value={token}
          onChange={(event) => setToken(event.target.value)}
          style={{
            boxSizing: "border-box",
            width: "100%",
            padding: "13px",
            border: "1px solid #CBD5E1",
            borderRadius: "9px",
            fontSize: "16px"
          }}
        />

        <div style={{ display: "grid", gap: "10px", marginTop: "18px" }}>
          <button
            type="button"
            disabled={busy !== null}
            onClick={() => void runDiagnostic("browser")}
            style={{
              border: 0,
              borderRadius: "9px",
              padding: "13px",
              background: "#F97316",
              color: "#FFFFFF",
              fontWeight: 700,
              cursor: busy ? "wait" : "pointer",
              opacity: busy ? 0.7 : 1
            }}
          >
            {busy === "browser" ? "Testing browser…" : "Test browser reporting"}
          </button>
          <button
            type="button"
            disabled={busy !== null}
            onClick={() => void runDiagnostic("server")}
            style={{
              border: "1px solid #1E293B",
              borderRadius: "9px",
              padding: "13px",
              background: "#1E293B",
              color: "#FFFFFF",
              fontWeight: 700,
              cursor: busy ? "wait" : "pointer",
              opacity: busy ? 0.7 : 1
            }}
          >
            {busy === "server" ? "Testing server…" : "Test server reporting"}
          </button>
        </div>

        <p role="status" aria-live="polite" style={{ minHeight: "24px", marginTop: "18px", color: "#334155" }}>
          {message}
        </p>
        <p style={{ margin: "12px 0 0", color: "#64748B", fontSize: "12px" }}>
          Temporary diagnostic only. Do not use this page in Production.
        </p>
      </section>
    </main>
  );
}
