"use client";

import { useState } from "react";

export default function SentryCheckClient() {
  const [status, setStatus] = useState("Ready to send one controlled test error.");

  async function sendTestError() {
    setStatus("Sending test error…");

    try {
      const response = await fetch("/api/sentry-check", { method: "POST" });

      if (response.status === 500) {
        setStatus("The preview endpoint returned the expected error. Check the Sentry project for the test event.");
      } else {
        setStatus(`Unexpected response: ${response.status}. Check the deployment logs.`);
      }
    } catch {
      setStatus("The request could not be completed. Check the preview deployment.");
    }
  }

  return (
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
      <section style={{ width: "100%", maxWidth: "480px" }}>
        <p style={{ color: "#1E293B", fontWeight: 700, letterSpacing: "0.1em" }}>
          SELLPILOT · MONITORING CHECK
        </p>
        <h1 style={{ fontSize: "28px", lineHeight: 1.2 }}>Send a test event</h1>
        <p style={{ color: "#475569", lineHeight: 1.6 }}>
          This preview-only check intentionally triggers one server error so we can confirm that Sentry receives it. No customer information is submitted.
        </p>
        <button
          type="button"
          onClick={sendTestError}
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
          Send test error
        </button>
        <p role="status" aria-live="polite" style={{ marginTop: "16px", color: "#1E293B" }}>
          {status}
        </p>
        <p style={{ marginTop: "24px", color: "#64748B", fontSize: "13px" }}>
          This diagnostic page and endpoint are disabled on production deployments.
        </p>
      </section>
    </main>
  );
}
