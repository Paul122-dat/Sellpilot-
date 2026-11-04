"use client";

import { useEffect, useMemo, useState, useTransition, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import { createCustomer, updateCustomer } from "./actions";

export type CustomerRecord = {
  id: string;
  name: string;
  phone_number: string | null;
  whatsapp_number: string | null;
  email: string | null;
  instagram_handle: string | null;
  delivery_address: string | null;
  notes: string | null;
  created_at: string;
};

const emptyForm = {
  name: "",
  phone_number: "",
  whatsapp_number: "",
  email: "",
  instagram_handle: "",
  delivery_address: "",
  notes: "",
};

export default function CustomerManager({ initialCustomers }: { initialCustomers: CustomerRecord[] }) {
  const router = useRouter();
  const [customers, setCustomers] = useState(initialCustomers);
  const [query, setQuery] = useState("");
  const [editing, setEditing] = useState<CustomerRecord | null>(null);
  const [form, setForm] = useState(emptyForm);
  const [error, setError] = useState("");
  const [isPending, startTransition] = useTransition();

  useEffect(() => {
    setCustomers(initialCustomers);
  }, [initialCustomers]);

  const filtered = useMemo(() => {
    const term = query.trim().toLowerCase();
    if (!term) return customers;
    return customers.filter((customer) =>
      [customer.name, customer.phone_number, customer.whatsapp_number, customer.email, customer.instagram_handle]
        .some((value) => value?.toLowerCase().includes(term)),
    );
  }, [customers, query]);

  function openNew() {
    setEditing(null);
    setForm(emptyForm);
    setError("");
  }

  function openEdit(customer: CustomerRecord) {
    setEditing(customer);
    setForm({
      name: customer.name,
      phone_number: customer.phone_number ?? "",
      whatsapp_number: customer.whatsapp_number ?? "",
      email: customer.email ?? "",
      instagram_handle: customer.instagram_handle ?? "",
      delivery_address: customer.delivery_address ?? "",
      notes: customer.notes ?? "",
    });
    setError("");
  }

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError("");
    const formData = new FormData(event.currentTarget);
    startTransition(async () => {
      const result = editing
        ? await updateCustomer(editing.id, formData)
        : await createCustomer(formData);
      if (result.error) {
        setError(result.error);
        return;
      }
      setForm(emptyForm);
      setEditing(null);
      router.refresh();
    });
  }

  const fields = [
    { key: "name", label: "Customer name", required: true, placeholder: "e.g. Ada Okafor" },
    { key: "phone_number", label: "Phone number", placeholder: "+234..." },
    { key: "whatsapp_number", label: "WhatsApp number", placeholder: "If different from phone" },
    { key: "email", label: "Email address", placeholder: "name@example.com" },
    { key: "instagram_handle", label: "Instagram handle", placeholder: "@username" },
  ] as const;

  return (
    <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_minmax(280px,0.85fr)]">
      <section className="rounded-2xl border border-[var(--line)] bg-white p-5 shadow-sm sm:p-6">
        <div className="flex items-center justify-between gap-3">
          <div><h2 className="font-bold text-[var(--navy)]">Customer list</h2><p className="mt-1 text-xs text-slate-500">{customers.length} saved {customers.length === 1 ? "customer" : "customers"}</p></div>
          <button type="button" onClick={openNew} className="rounded-xl bg-[var(--orange)] px-4 py-2.5 text-sm font-bold text-white">Add customer</button>
        </div>
        <label className="mt-5 block"><span className="sr-only">Search customers</span><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search name, phone, email or Instagram" className="w-full rounded-xl border border-[var(--line)] px-4 py-3 text-sm outline-none focus:border-orange-400" /></label>
        <div className="mt-4 divide-y divide-slate-100">
          {filtered.length === 0 ? (
            <div className="py-12 text-center"><p className="text-sm font-semibold text-slate-700">{customers.length === 0 ? "No customers yet" : "No matching customers"}</p><p className="mt-1 text-xs text-slate-500">{customers.length === 0 ? "Add your first customer to start building your customer list." : "Try another name or contact detail."}</p></div>
          ) : filtered.map((customer) => (
            <button key={customer.id} type="button" onClick={() => openEdit(customer)} className="flex w-full items-center gap-3 py-4 text-left hover:bg-slate-50">
              <span className="grid h-10 w-10 shrink-0 place-items-center rounded-full bg-orange-50 text-sm font-bold text-[var(--orange)]">{customer.name.slice(0, 1).toUpperCase()}</span>
              <span className="min-w-0 flex-1"><span className="block truncate text-sm font-semibold text-slate-800">{customer.name}</span><span className="mt-1 block truncate text-xs text-slate-500">{customer.phone_number || customer.email || customer.whatsapp_number || "No contact details added"}</span></span>
              <span className="text-xs font-semibold text-[var(--orange)]">Edit</span>
            </button>
          ))}
        </div>
      </section>

      <section className="rounded-2xl border border-[var(--line)] bg-white p-5 shadow-sm sm:p-6">
        <h2 className="font-bold text-[var(--navy)]">{editing ? "Edit customer" : "New customer"}</h2>
        <p className="mt-1 text-xs text-slate-500">Only the customer's name is required. Add other details when available.</p>
        <form key={editing?.id ?? "new"} onSubmit={submit} className="mt-5 space-y-3">
          {fields.map((field) => <label key={field.key} className="block"><span className="mb-1.5 block text-xs font-semibold text-slate-600">{field.label}{field.required ? " *" : ""}</span><input name={field.key} required={field.required} maxLength={field.key === "name" ? 160 : field.key === "email" ? 254 : 80} value={form[field.key]} onChange={(event) => setForm((current) => ({ ...current, [field.key]: event.target.value }))} placeholder={field.placeholder} className="w-full rounded-xl border border-[var(--line)] px-3.5 py-2.5 text-sm outline-none focus:border-orange-400" /></label>)}
          <label className="block"><span className="mb-1.5 block text-xs font-semibold text-slate-600">Delivery address</span><textarea name="delivery_address" maxLength={500} rows={2} value={form.delivery_address} onChange={(event) => setForm((current) => ({ ...current, delivery_address: event.target.value }))} className="w-full rounded-xl border border-[var(--line)] px-3.5 py-2.5 text-sm outline-none focus:border-orange-400" placeholder="Customer's preferred delivery address" /></label>
          <label className="block"><span className="mb-1.5 block text-xs font-semibold text-slate-600">Notes</span><textarea name="notes" maxLength={2000} rows={3} value={form.notes} onChange={(event) => setForm((current) => ({ ...current, notes: event.target.value }))} className="w-full rounded-xl border border-[var(--line)] px-3.5 py-2.5 text-sm outline-none focus:border-orange-400" placeholder="Useful details about this customer" /></label>
          {error && <p role="alert" className="rounded-xl bg-red-50 p-3 text-xs text-red-700">{error}</p>}
          <div className="flex gap-2 pt-1"><button disabled={isPending} type="submit" className="flex-1 rounded-xl bg-[var(--orange)] px-4 py-3 text-sm font-bold text-white disabled:opacity-60">{isPending ? "Saving..." : editing ? "Save changes" : "Save customer"}</button>{editing && <button type="button" onClick={openNew} className="rounded-xl border border-[var(--line)] px-4 py-3 text-sm font-semibold text-slate-600">Cancel</button>}</div>
        </form>
      </section>
    </div>
  );
}
