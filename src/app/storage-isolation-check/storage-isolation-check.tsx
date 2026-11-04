"use client";

import { useState } from "react";
import { createSupabaseBrowserClient } from "@/lib/supabase/client";

export default function StorageIsolationCheck({ ownImagePaths }: { ownImagePaths: string[] }) {
  const [path, setPath] = useState("");
  const [result, setResult] = useState("");
  const [busy, setBusy] = useState(false);

  async function checkAccess() {
    const clean = path.trim();
    const parts = clean.split("/");
    if (parts.length !== 3 || parts.some((part) => !part)) {
      setResult("Enter the exact three-part photo path: business ID / product ID / filename.");
      return;
    }
    setBusy(true);
    setResult("");
    try {
      const supabase = createSupabaseBrowserClient();
      const { data, error } = await supabase.storage
        .from("product-images")
        .list(parts.slice(0, 2).join("/"), { search: parts[2], limit: 10 });
      if (error) {
        setResult("ACCESS DENIED / REQUEST ERROR: " + error.message);
      } else if ((data ?? []).some((item) => item.name === parts[2])) {
        setResult("UNEXPECTED ACCESS: this account can list the other business's photo object. Do not share or change anything; report this result.");
      } else {
        setResult("NO ACCESS: the photo object was not returned to this account. This is the expected isolation result.");
      }
    } catch {
      setResult("The check could not complete. Please report this result.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <main className="min-h-screen bg-[var(--surface)] px-4 py-8">
      <div className="mx-auto max-w-2xl rounded-2xl border border-slate-200 bg-white p-5 shadow-sm sm:p-7">
        <p className="text-sm font-semibold text-[var(--orange)]">Temporary security test</p>
        <h1 className="mt-2 text-2xl font-bold text-[var(--navy)]">Product photo access check</h1>
        <p className="mt-3 text-sm text-slate-600">This read-only check asks Supabase Storage whether the signed-in account can list one exact photo object. It does not download, upload, replace or delete the photo.</p>
        {ownImagePaths.length > 0 && (
          <section className="mt-5 rounded-xl bg-slate-50 p-3">
            <p className="text-xs font-semibold text-slate-700">Photo paths belonging to this account</p>
            {ownImagePaths.map((item) => <p key={item} className="mt-2 break-all select-all text-xs text-slate-600">{item}</p>)}
            <p className="mt-2 text-xs text-slate-500">On the first account, copy the TEST T-SHIRT photo path. Keep it private and paste it below after switching accounts.</p>
          </section>
        )}
        <label htmlFor="photo-path" className="mt-5 block text-sm font-semibold text-slate-700">Exact photo path to test</label>
        <textarea id="photo-path" value={path} onChange={(event) => setPath(event.target.value)} rows={3} placeholder="business-id/product-id/photo-filename.jpg" className="mt-2 w-full rounded-xl border border-slate-300 p-3 text-sm text-slate-800 outline-none focus:border-[var(--orange)]" />
        <button type="button" onClick={checkAccess} disabled={busy || !path.trim()} className="mt-3 rounded-xl bg-[var(--orange)] px-5 py-3 text-sm font-semibold text-white disabled:opacity-50">{busy ? "Checking…" : "Check photo access"}</button>
        {result && <p role="status" className="mt-4 break-words rounded-xl bg-slate-50 p-3 text-sm text-slate-700">{result}</p>}
        <p className="mt-5 text-xs text-slate-400">Temporary diagnostic page. Remove after testing.</p>
      </div>
    </main>
  );
}
