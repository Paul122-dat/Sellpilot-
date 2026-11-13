"use client";

import * as Sentry from "@sentry/nextjs";
import { useState } from "react";

export default function SentryCheckClient() {
  const [serverStatus, setServerStatus] = useState("Ready to send one controlled server-side test error.");
  const [browserStatus, setBrowserStatus] = useState("Ready to send one controlled browser-side test error.");

  async function sendServerTestError() {
    setServerStatus("Sending server-side test error…");

    try {
      const response = await fetch("/api/sentry-check", { method: "POST" });

      if (response.status === 500) {
        setServerStatus("The preview endpoint returned the expected error. Check Sentry for the server-side test event.");
      } else {
        setServerStatus(`Unexpected response: ${response.status}. Check the deployment logs.`);
      }
    } catch {
      setServerStatus("The request could not be completed. Check the preview deployment.");
    }
  }

  async function sendBrowserTestError() {
    setBrowserStatus("Sending browser-side test error…");

    try {
      Sentry.captureException(new Error("SellPilot Sentry browser preview smoke test"));
      const flushed = await Sentry.flush(2000);

      setBrowserStatus(
        flushed
          ? "Browser-side test event sent. Check Sentry for the browser test issue."
          : "The event was captured locally, but Sentry did not confirm delivery within 2 seconds. Check Sentry again shortly."
      );
    } catch {
      setBrowserStatus("The browser test could not be sent. Check the browser console and Preview deployment.");
    }
  }

  const buttonStyle = {
    border: 0,
    borderRadius: "10px",
    padding: "12px 20px",
    background: "#F97316",
    color: "#FFFFFF",
    fontWeight: 700,
    cursor: "pointer"
  } as const;

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
        <h1 style={{ fontSize: "28px", lineHeight: 1.2 }}>Test error reporting</h1>
        <p style={{ color: "#475569", lineHeight: 1.6 }}>
          These controls intentionally send test exceptions from the Preview environment. No customer information is submitted.
        </p>

        <section style={{ marginTop: "24px" }}>
          <h2 style={{ fontSize: "18px", marginBottom: "8px" }}>Server-side test</h2>
          <button type="button" onClick={sendServerTestError} style={buttonStyle}>
            Send server test error
          </button>
          <p role="status" aria-live="polite" style={{ marginTop: "12px", color: "#1E293B" }}>
            {serverStatus}
          </p>
        </section>

        <section style={{ marginTop: "24px" }}>
          <h2 style={{ fontSize: "18px", marginBottom: "8px" }}>Browser-side test</h2>
          <button type="button" onClick={sendBrowserTestError} style={buttonStyle}>
            Send browser test error
          </button>
          <p role="status" aria-live="polite" style={{ marginTop: "12px", color: "#1E293B" }}>
            {browserStatus}
          </p>
        </section>

        <p style={{ marginTop: "24px", color: "#64748B", fontSize: "13px" }}>
          This diagnostic page and endpoint are disabled on production deployments.
        </p>
      </section>
    </main>
  );
}
