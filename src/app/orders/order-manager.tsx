"use client";

import { useEffect, useMemo, useState, useTransition, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import { ArrowRight, CreditCard, Plus, Search, ShoppingBag, Truck, UserRound, X } from "lucide-react";
import { advanceOrderStatus, createOrder, recordOrderTransaction } from "./actions";

export type OrderItemRecord = {
  id: string; order_id: string; product_id: string | null; product_name: string;
  quantity: number; unit_price: number; line_total: number;
};
export type OrderTransactionRecord = {
  id: string; order_id: string; transaction_type: "payment" | "refund";
  amount: number; payment_method: string; reference: string | null;
  note: string | null; recorded_at: string;
};
export type OrderRecord = {
  id: string; order_number: string | null; customer_id: string | null;
  customer_name: string; customer_phone: string | null; sales_channel: string;
  order_status: string; currency_code: string; subtotal_amount: number;
  discount_amount: number; delivery_fee: number; total_amount: number;
  expected_delivery_date: string | null; delivery_address: string | null;
  notes: string | null; created_at: string; amount_received: number;
  amount_refunded: number; net_amount_received: number; balance_due: number;
  payment_status: string; items: OrderItemRecord[];
  transactions: OrderTransactionRecord[];
};
export type OrderCustomerChoice = {
  id: string; name: string; phone_number: string | null;
  whatsapp_number: string | null; delivery_address: string | null;
};
export type OrderProductChoice = {
  id: string; name: string; sku: string | null; selling_price: number;
  track_inventory: boolean; stock_on_hand: number | null;
};
type DraftItem = { product_id: string; quantity: number };

const ORDER_FLOW = ["pending", "confirmed", "processing", "ready", "dispatched", "delivered"] as const;
const STATUS_LABELS: Record<string, string> = {
  pending: "Pending confirmation", confirmed: "Confirmed", processing: "Processing",
  ready: "Ready", dispatched: "Dispatched", delivered: "Delivered", cancelled: "Cancelled",
};
const PAYMENT_LABELS: Record<string, string> = {
  unpaid: "Unpaid", partially_paid: "Partially paid", paid: "Paid",
  overpaid: "Overpaid", no_payment_required: "No payment required",
};

function money(value: number) {
  return new Intl.NumberFormat("en-NG", { style: "currency", currency: "NGN", maximumFractionDigits: 2 })
    .format(Number.isFinite(value) ? value : 0);
}
function statusTone(status: string) {
  if (status === "delivered" || status === "paid") return "bg-emerald-50 text-emerald-700";
  if (status === "cancelled" || status === "unpaid") return "bg-slate-100 text-slate-600";
  if (status === "partially_paid" || status === "pending") return "bg-amber-50 text-amber-700";
  return "bg-orange-50 text-orange-700";
}
function dateLabel(value: string) {
  return new Intl.DateTimeFormat("en-NG", { dateStyle: "medium" }).format(new Date(value));
}

export default function OrderManager({
  initialOrders, customers, products,
}: {
  initialOrders: OrderRecord[]; customers: OrderCustomerChoice[]; products: OrderProductChoice[];
}) {
  const router = useRouter();
  const [orders, setOrders] = useState(initialOrders);
  const [query, setQuery] = useState("");
  const [statusFilter, setStatusFilter] = useState("all");
  const [selectedId, setSelectedId] = useState(initialOrders[0]?.id ?? "");
  const [draftItems, setDraftItems] = useState<DraftItem[]>([{ product_id: "", quantity: 1 }]);
  const [customerId, setCustomerId] = useState("");
  const [transactionType, setTransactionType] = useState<"payment" | "refund">("payment");
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");
  const [isPending, startTransition] = useTransition();

  useEffect(() => {
    setOrders(initialOrders);
    if (selectedId && !initialOrders.some((order) => order.id === selectedId)) setSelectedId(initialOrders[0]?.id ?? "");
    if (!selectedId && initialOrders[0]) setSelectedId(initialOrders[0].id);
  }, [initialOrders, selectedId]);

  const filteredOrders = useMemo(() => {
    const term = query.trim().toLowerCase();
    return orders.filter((order) => {
      if (statusFilter !== "all" && order.order_status !== statusFilter) return false;
      if (!term) return true;
      return [order.order_number, order.customer_name, order.customer_phone, order.sales_channel]
        .some((value) => value?.toLowerCase().includes(term));
    });
  }, [orders, query, statusFilter]);

  const selectedOrder = orders.find((order) => order.id === selectedId) ?? null;
  const selectedCustomer = customers.find((customer) => customer.id === customerId) ?? null;
  const activeOrders = orders.filter((order) => !["delivered", "cancelled"].includes(order.order_status));
  const outstandingAmount = orders
    .filter((order) => order.order_status !== "cancelled")
    .reduce((sum, order) => sum + Math.max(0, order.balance_due), 0);
  const flowIndex = selectedOrder ? ORDER_FLOW.indexOf(selectedOrder.order_status as typeof ORDER_FLOW[number]) : -1;
  const nextStatus = flowIndex >= 0 ? ORDER_FLOW[flowIndex + 1] : undefined;

  function changeDraftItem(index: number, patch: Partial<DraftItem>) {
    setDraftItems((current) => current.map((item, itemIndex) => itemIndex === index ? { ...item, ...patch } : item));
  }

  function submitOrder(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError("");
    setSuccess("");
    const formElement = event.currentTarget;
    const data = new FormData(formElement);
    data.set("items", JSON.stringify(draftItems));
    startTransition(async () => {
      const result = await createOrder(data);
      if (result.error || !result.orderId) {
        setError(result.error ?? "We couldn't create this order.");
        return;
      }
      setDraftItems([{ product_id: "", quantity: 1 }]);
      setCustomerId("");
      formElement.reset();
      setSuccess("Order created. It is pending confirmation and has not reduced stock yet.");
      setSelectedId(result.orderId);
      router.refresh();
    });
  }

  function updateStatus(status: string) {
    if (!selectedOrder) return;
    setError("");
    setSuccess("");
    if (status === "cancelled" && !window.confirm(
      selectedOrder.order_status === "pending"
        ? "Cancel this pending order?"
        : "Cancel this order? Any stock deducted when it was confirmed will be returned to inventory.",
    )) return;
    startTransition(async () => {
      const result = await advanceOrderStatus(selectedOrder.id, status);
      if (result.error) { setError(result.error); return; }
      setSuccess(status === "cancelled" ? "Order cancelled. Applicable stock has been restored." : "Order marked " + STATUS_LABELS[status].toLowerCase() + ".");
      router.refresh();
    });
  }

  function submitTransaction(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!selectedOrder) return;
    setError("");
    setSuccess("");
    const formElement = event.currentTarget;
    const data = new FormData(formElement);
    data.set("order_id", selectedOrder.id);
    data.set("transaction_type", transactionType);
    startTransition(async () => {
      const result = await recordOrderTransaction(data);
      if (result.error) { setError(result.error); return; }
      formElement.reset();
      setSuccess(transactionType === "refund" ? "Refund recorded." : "Payment recorded.");
      router.refresh();
    });
  }

  return (
    <div className="space-y-6">
      <div className="grid gap-3 sm:grid-cols-3">
        <article className="rounded-2xl border border-[var(--line)] bg-white p-4">
          <p className="text-xs font-medium text-slate-500">Orders in this view</p>
          <p className="mt-2 text-2xl font-bold text-[var(--navy)]">{orders.length}</p>
        </article>
        <article className="rounded-2xl border border-[var(--line)] bg-white p-4">
          <p className="text-xs font-medium text-slate-500">Active in this view</p>
          <p className="mt-2 text-2xl font-bold text-[var(--navy)]">{activeOrders.length}</p>
        </article>
        <article className="rounded-2xl border border-[var(--line)] bg-white p-4">
          <p className="text-xs font-medium text-slate-500">Outstanding in this view</p>
          <p className="mt-2 text-xl font-bold text-[var(--navy)]">{money(outstandingAmount)}</p>
        </article>
      </div>

      <div className="grid items-start gap-6 xl:grid-cols-[minmax(0,1.2fr)_minmax(320px,.8fr)]">
        <section className="min-w-0 rounded-2xl border border-[var(--line)] bg-white p-5 shadow-sm sm:p-6">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div><h2 className="font-bold text-[var(--navy)]">Order records</h2><p className="mt-1 text-xs text-slate-500">Select an order to view details and payment history.</p></div>
            <span className="rounded-full bg-slate-100 px-3 py-1 text-xs font-semibold text-slate-600">{filteredOrders.length} shown</span>
          </div>
          <div className="mt-5 grid gap-2 sm:grid-cols-[minmax(0,1fr)_180px]">
            <label className="relative block">
              <Search size={16} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
              <input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search order, customer or channel" aria-label="Search orders" className="w-full rounded-xl border border-[var(--line)] py-3 pl-9 pr-3 text-sm outline-none focus:border-orange-400" />
            </label>
            <select value={statusFilter} onChange={(event) => setStatusFilter(event.target.value)} aria-label="Filter by order status" className="rounded-xl border border-[var(--line)] bg-white px-3 py-3 text-sm text-slate-700">
              <option value="all">All order statuses</option>
              {Object.entries(STATUS_LABELS).map(([value, label]) => <option key={value} value={value}>{label}</option>)}
            </select>
          </div>
          <div className="mt-3 divide-y divide-slate-100">
            {filteredOrders.length === 0 ? (
              <div className="py-12 text-center">
                <ShoppingBag size={23} className="mx-auto text-slate-300" />
                <p className="mt-3 text-sm font-semibold text-slate-700">{orders.length ? "No matching orders" : "No orders yet"}</p>
                <p className="mt-1 text-xs text-slate-500">{orders.length ? "Try another search or status filter." : "Create your first order using the form."}</p>
              </div>
            ) : filteredOrders.map((order) => (
              <button key={order.id} type="button" onClick={() => { setSelectedId(order.id); setError(""); setSuccess(""); }} className={"flex w-full items-center gap-3 rounded-xl px-2 py-4 text-left transition hover:bg-slate-50 " + (selectedId === order.id ? "bg-orange-50/70" : "")}>
                <span className="grid h-10 w-10 shrink-0 place-items-center rounded-xl bg-slate-100 text-slate-600"><ShoppingBag size={18} /></span>
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-sm font-semibold text-slate-800">{order.customer_name}</span>
                  <span className="mt-1 block truncate text-xs text-slate-500">{order.order_number ?? order.id.slice(0, 8)} · {order.sales_channel.replace("_", " ")} · {dateLabel(order.created_at)}</span>
                </span>
                <span className="shrink-0 text-right">
                  <span className="block text-sm font-bold text-[var(--navy)]">{money(order.total_amount)}</span>
                  <span className={"mt-1 inline-block rounded-full px-2 py-1 text-[10px] font-semibold " + statusTone(order.order_status)}>{STATUS_LABELS[order.order_status] ?? order.order_status}</span>
                </span>
              </button>
            ))}
          </div>
          <p className="mt-4 border-t border-[var(--line)] pt-3 text-[11px] leading-5 text-slate-400">The list and summary cards use the latest 100 orders. Older records remain saved and will be available through future date filters.</p>
        </section>

        <section className="rounded-2xl border border-[var(--line)] bg-white p-5 shadow-sm sm:p-6">
          <div className="flex items-center justify-between gap-3">
            <div><h2 className="font-bold text-[var(--navy)]">Create an order</h2><p className="mt-1 text-xs text-slate-500">Use saved customers and active products.</p></div>
            <span className="rounded-xl bg-orange-50 p-2 text-[var(--orange)]"><Plus size={18} /></span>
          </div>
          {products.length === 0 ? (
            <div className="mt-5 rounded-xl bg-amber-50 p-4 text-xs leading-5 text-amber-800">Add an active product in Products & stock before creating an order.</div>
          ) : (
            <form onSubmit={submitOrder} className="mt-5 space-y-3">
              <label className="block">
                <span className="mb-1.5 block text-xs font-semibold text-slate-600">Existing customer (optional)</span>
                <select name="customer_id" value={customerId} onChange={(event) => setCustomerId(event.target.value)} className="w-full rounded-xl border border-[var(--line)] bg-white px-3.5 py-2.5 text-sm">
                  <option value="">Enter customer details below</option>
                  {customers.map((customer) => <option key={customer.id} value={customer.id}>{customer.name}</option>)}
                </select>
              </label>
              {!selectedCustomer && <>
                <label className="block"><span className="mb-1.5 block text-xs font-semibold text-slate-600">Customer name *</span><input name="customer_name" required maxLength={160} placeholder="e.g. Ada Okafor" className="w-full rounded-xl border border-[var(--line)] px-3.5 py-2.5 text-sm outline-none focus:border-orange-400" /></label>
                <label className="block"><span className="mb-1.5 block text-xs font-semibold text-slate-600">Phone / WhatsApp number</span><input name="customer_phone" maxLength={40} placeholder="+234..." className="w-full rounded-xl border border-[var(--line)] px-3.5 py-2.5 text-sm outline-none focus:border-orange-400" /></label>
              </>}
              {selectedCustomer && <p className="rounded-lg bg-slate-50 px-3 py-2 text-xs text-slate-600">Using saved contact: {selectedCustomer.phone_number || selectedCustomer.whatsapp_number || "No phone saved"}.</p>}
              <label className="block"><span className="mb-1.5 block text-xs font-semibold text-slate-600">Sales channel</span><select name="sales_channel" defaultValue="whatsapp" className="w-full rounded-xl border border-[var(--line)] bg-white px-3.5 py-2.5 text-sm"><option value="whatsapp">WhatsApp</option><option value="instagram">Instagram</option><option value="in_person">In person</option><option value="other">Other</option></select></label>

              <div className="border-t border-[var(--line)] pt-3">
                <div className="mb-2 flex items-center justify-between"><span className="text-xs font-bold text-slate-700">Order items</span><span className="text-[11px] text-slate-400">{draftItems.length} line{draftItems.length === 1 ? "" : "s"}</span></div>
                <div className="space-y-3">
                  {draftItems.map((item, index) => {
                    const product = products.find((entry) => entry.id === item.product_id);
                    return <div key={index} className="rounded-xl border border-[var(--line)] p-3">
                      <div className="flex items-center gap-2">
                        <select value={item.product_id} onChange={(event) => changeDraftItem(index, { product_id: event.target.value })} required aria-label={"Product " + (index + 1)} className="min-w-0 flex-1 rounded-lg border border-[var(--line)] bg-white px-2.5 py-2 text-xs">
                          <option value="">Choose product</option>
                          {products.map((entry) => <option key={entry.id} value={entry.id}>{entry.name} · {money(entry.selling_price)}</option>)}
                        </select>
                        {draftItems.length > 1 && <button type="button" onClick={() => setDraftItems((current) => current.filter((_, i) => i !== index))} aria-label="Remove order item" className="rounded-lg p-2 text-slate-400 hover:bg-red-50 hover:text-red-600"><X size={15} /></button>}
                      </div>
                      <div className="mt-2 flex items-center justify-between gap-3">
                        <label className="flex items-center gap-2 text-xs text-slate-500">Qty <input type="number" min="1" max="999999" step="1" required value={item.quantity} onChange={(event) => changeDraftItem(index, { quantity: Number(event.target.value) })} className="w-20 rounded-lg border border-[var(--line)] px-2 py-2 text-sm text-slate-800" /></label>
                        <span className="text-right text-xs text-slate-500">{product ? money(product.selling_price * item.quantity) : "Select a product"}{product?.track_inventory ? <span className="mt-1 block text-[10px]">Stock: {product.stock_on_hand ?? 0}</span> : null}</span>
                      </div>
                    </div>;
                  })}
                </div>
                <button type="button" onClick={() => setDraftItems((current) => [...current, { product_id: "", quantity: 1 }])} className="mt-3 inline-flex items-center gap-1.5 text-xs font-semibold text-[var(--orange)]"><Plus size={14} /> Add another product</button>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <label className="block"><span className="mb-1.5 block text-xs font-semibold text-slate-600">Discount (₦)</span><input name="discount_amount" type="number" min="0" step="0.01" defaultValue="0" className="w-full rounded-xl border border-[var(--line)] px-3 py-2.5 text-sm" /></label>
                <label className="block"><span className="mb-1.5 block text-xs font-semibold text-slate-600">Delivery fee (₦)</span><input name="delivery_fee" type="number" min="0" step="0.01" defaultValue="0" className="w-full rounded-xl border border-[var(--line)] px-3 py-2.5 text-sm" /></label>
              </div>
              <label className="block"><span className="mb-1.5 block text-xs font-semibold text-slate-600">Expected delivery date</span><input name="expected_delivery_date" type="date" min={new Date().toISOString().slice(0, 10)} className="w-full rounded-xl border border-[var(--line)] px-3.5 py-2.5 text-sm" /></label>
              <label className="block"><span className="mb-1.5 block text-xs font-semibold text-slate-600">Delivery address</span><textarea name="delivery_address" rows={2} maxLength={1000} defaultValue={selectedCustomer?.delivery_address ?? ""} placeholder="Delivery location (optional)" className="w-full rounded-xl border border-[var(--line)] px-3.5 py-2.5 text-sm" /></label>
              <label className="block"><span className="mb-1.5 block text-xs font-semibold text-slate-600">Order notes</span><textarea name="notes" rows={2} maxLength={2000} placeholder="Optional instructions" className="w-full rounded-xl border border-[var(--line)] px-3.5 py-2.5 text-sm" /></label>

              <div className="border-t border-[var(--line)] pt-3">
                <p className="mb-2 text-xs font-bold text-slate-700">Payment received now (optional)</p>
                <div className="grid grid-cols-2 gap-3">
                  <label className="block"><span className="mb-1.5 block text-xs font-semibold text-slate-600">Amount (₦)</span><input name="initial_payment_amount" type="number" min="0" step="0.01" defaultValue="0" className="w-full rounded-xl border border-[var(--line)] px-3 py-2.5 text-sm" /></label>
                  <label className="block"><span className="mb-1.5 block text-xs font-semibold text-slate-600">Method</span><select name="initial_payment_method" defaultValue="bank_transfer" className="w-full rounded-xl border border-[var(--line)] bg-white px-2 py-2.5 text-xs"><option value="cash">Cash</option><option value="bank_transfer">Bank transfer</option><option value="card">Card</option><option value="online">Online</option><option value="other">Other</option></select></label>
                </div>
                <label className="mt-3 block"><span className="mb-1.5 block text-xs font-semibold text-slate-600">Payment reference (optional)</span><input name="initial_payment_reference" maxLength={160} className="w-full rounded-xl border border-[var(--line)] px-3.5 py-2.5 text-sm" placeholder="Transaction reference" /></label>
              </div>
              {error && <p role="alert" className="rounded-xl bg-red-50 p-3 text-xs leading-5 text-red-700">{error}</p>}
              {success && <p role="status" className="rounded-xl bg-emerald-50 p-3 text-xs leading-5 text-emerald-700">{success}</p>}
              <button disabled={isPending || products.length === 0 || draftItems.some((item) => !item.product_id || item.quantity < 1)} type="submit" className="w-full rounded-xl bg-[var(--orange)] px-4 py-3 text-sm font-bold text-white disabled:opacity-60">{isPending ? "Saving order..." : "Create order"}</button>
              <p className="text-[11px] leading-5 text-slate-400">New orders start as pending. Stock is deducted only when you confirm the order.</p>
            </form>
          )}
        </section>
      </div>

      {selectedOrder && <section className="rounded-2xl border border-[var(--line)] bg-white p-5 shadow-sm sm:p-6">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <p className="text-xs font-semibold uppercase tracking-wider text-[var(--orange)]">Order details</p>
            <h2 className="mt-1 text-xl font-bold text-[var(--navy)]">{selectedOrder.order_number ?? selectedOrder.id.slice(0, 8)}</h2>
            <p className="mt-1 text-xs text-slate-500">Created {dateLabel(selectedOrder.created_at)} · {selectedOrder.sales_channel.replace("_", " ")}</p>
          </div>
          <div className="flex flex-wrap gap-2">
            <span className={"rounded-full px-3 py-1.5 text-xs font-semibold " + statusTone(selectedOrder.order_status)}>{STATUS_LABELS[selectedOrder.order_status] ?? selectedOrder.order_status}</span>
            <span className={"rounded-full px-3 py-1.5 text-xs font-semibold " + statusTone(selectedOrder.payment_status)}>{PAYMENT_LABELS[selectedOrder.payment_status] ?? selectedOrder.payment_status}</span>
          </div>
        </div>

        <div className="mt-5 grid gap-5 lg:grid-cols-[minmax(0,1.2fr)_minmax(280px,.8fr)]">
          <div className="space-y-5">
            <div className="rounded-xl bg-slate-50 p-4">
              <div className="flex items-start gap-3"><UserRound size={18} className="mt-0.5 text-slate-400" /><div><p className="text-sm font-semibold text-slate-800">{selectedOrder.customer_name}</p><p className="mt-1 text-xs text-slate-500">{selectedOrder.customer_phone || "No phone number saved"}</p></div></div>
              {selectedOrder.delivery_address && <div className="mt-3 flex items-start gap-3"><Truck size={18} className="mt-0.5 text-slate-400" /><p className="text-xs leading-5 text-slate-600">{selectedOrder.delivery_address}</p></div>}
              {selectedOrder.expected_delivery_date && <p className="mt-3 text-xs text-slate-500">Expected delivery: {dateLabel(selectedOrder.expected_delivery_date)}</p>}
              {selectedOrder.notes && <p className="mt-3 border-t border-slate-200 pt-3 text-xs leading-5 text-slate-600">{selectedOrder.notes}</p>}
            </div>
            <div>
              <h3 className="text-sm font-bold text-[var(--navy)]">Items</h3>
              <div className="mt-2 divide-y divide-slate-100 rounded-xl border border-[var(--line)] px-3">
                {selectedOrder.items.map((item) => <div key={item.id} className="flex items-center justify-between gap-3 py-3"><span className="min-w-0"><span className="block truncate text-sm font-semibold text-slate-700">{item.product_name}</span><span className="mt-1 block text-xs text-slate-500">{item.quantity} × {money(item.unit_price)}</span></span><span className="shrink-0 text-sm font-semibold text-slate-800">{money(item.line_total)}</span></div>)}
              </div>
              <div className="ml-auto mt-3 max-w-sm space-y-2 text-sm">
                <div className="flex justify-between text-slate-500"><span>Subtotal</span><span>{money(selectedOrder.subtotal_amount)}</span></div>
                <div className="flex justify-between text-slate-500"><span>Discount</span><span>−{money(selectedOrder.discount_amount)}</span></div>
                <div className="flex justify-between text-slate-500"><span>Delivery fee</span><span>{money(selectedOrder.delivery_fee)}</span></div>
                <div className="flex justify-between border-t border-[var(--line)] pt-2 font-bold text-[var(--navy)]"><span>Order total</span><span>{money(selectedOrder.total_amount)}</span></div>
              </div>
            </div>
            <div>
              <h3 className="text-sm font-bold text-[var(--navy)]">Payment history</h3>
              {selectedOrder.transactions.length === 0 ? <p className="mt-2 rounded-xl border border-dashed border-slate-200 p-4 text-xs text-slate-500">No payments or refunds recorded yet.</p> : <div className="mt-2 divide-y divide-slate-100 rounded-xl border border-[var(--line)] px-3">{selectedOrder.transactions.map((transaction) => <div key={transaction.id} className="flex items-center justify-between gap-3 py-3"><span><span className="block text-xs font-semibold text-slate-700">{transaction.transaction_type === "refund" ? "Refund" : "Payment"} · {transaction.payment_method.replace("_", " ")}</span><span className="mt-1 block text-[11px] text-slate-400">{dateLabel(transaction.recorded_at)}{transaction.reference ? " · " + transaction.reference : ""}</span></span><span className={"text-sm font-bold " + (transaction.transaction_type === "refund" ? "text-red-600" : "text-emerald-700")}>{transaction.transaction_type === "refund" ? "−" : "+"}{money(transaction.amount)}</span></div>)}</div>}
            </div>
          </div>

          <div className="space-y-4">
            <div className="rounded-xl border border-[var(--line)] p-4">
              <h3 className="flex items-center gap-2 text-sm font-bold text-[var(--navy)]"><CreditCard size={17} /> Payment summary</h3>
              <div className="mt-4 space-y-2 text-xs">
                <div className="flex justify-between text-slate-500"><span>Total received</span><span>{money(selectedOrder.amount_received)}</span></div>
                <div className="flex justify-between text-slate-500"><span>Refunded</span><span>{money(selectedOrder.amount_refunded)}</span></div>
                <div className="flex justify-between border-t border-[var(--line)] pt-2 font-bold text-[var(--navy)]"><span>Net received</span><span>{money(selectedOrder.net_amount_received)}</span></div>
                <div className="flex justify-between font-semibold text-slate-700"><span>{selectedOrder.balance_due < 0 ? "Overpaid" : "Balance due"}</span><span>{money(Math.abs(selectedOrder.balance_due))}</span></div>
              </div>
            </div>

            {selectedOrder.order_status !== "cancelled" && selectedOrder.order_status !== "delivered" && <div className="rounded-xl border border-[var(--line)] p-4">
              <h3 className="text-sm font-bold text-[var(--navy)]">Update order progress</h3>
              <p className="mt-1 text-xs leading-5 text-slate-500">Move one stage at a time so the order history stays clear.</p>
              {nextStatus && <button disabled={isPending} type="button" onClick={() => updateStatus(nextStatus)} className="mt-3 flex w-full items-center justify-center gap-2 rounded-xl bg-[var(--navy)] px-3 py-3 text-xs font-bold text-white disabled:opacity-60"><ArrowRight size={15} /> {isPending ? "Updating..." : "Mark as " + STATUS_LABELS[nextStatus]}</button>}
              <button disabled={isPending} type="button" onClick={() => updateStatus("cancelled")} className="mt-2 w-full rounded-xl border border-red-200 px-3 py-2.5 text-xs font-semibold text-red-600 disabled:opacity-60">Cancel order</button>
              {selectedOrder.order_status === "pending" && <p className="mt-3 text-[11px] leading-5 text-slate-400">Confirming this order deducts its tracked product quantities from stock.</p>}
            </div>}

            <form onSubmit={submitTransaction} className="rounded-xl border border-[var(--line)] p-4">
              <h3 className="text-sm font-bold text-[var(--navy)]">Record a transaction</h3>
              <label className="mt-3 block"><span className="mb-1.5 block text-xs font-semibold text-slate-600">Transaction</span><select value={transactionType} onChange={(event) => setTransactionType(event.target.value as "payment" | "refund")} className="w-full rounded-lg border border-[var(--line)] bg-white px-3 py-2.5 text-xs"><option value="payment">Payment received</option><option value="refund">Refund issued</option></select></label>
              <label className="mt-3 block"><span className="mb-1.5 block text-xs font-semibold text-slate-600">Amount (₦) *</span><input name="amount" required type="number" min="0.01" step="0.01" className="w-full rounded-lg border border-[var(--line)] px-3 py-2.5 text-sm" /></label>
              <label className="mt-3 block"><span className="mb-1.5 block text-xs font-semibold text-slate-600">Method</span><select name="payment_method" defaultValue="bank_transfer" className="w-full rounded-lg border border-[var(--line)] bg-white px-3 py-2.5 text-xs"><option value="cash">Cash</option><option value="bank_transfer">Bank transfer</option><option value="card">Card</option><option value="online">Online</option><option value="other">Other</option></select></label>
              <label className="mt-3 block"><span className="mb-1.5 block text-xs font-semibold text-slate-600">Reference</span><input name="reference" maxLength={160} className="w-full rounded-lg border border-[var(--line)] px-3 py-2.5 text-xs" placeholder="Optional transaction reference" /></label>
              <label className="mt-3 block"><span className="mb-1.5 block text-xs font-semibold text-slate-600">Note</span><input name="note" maxLength={500} className="w-full rounded-lg border border-[var(--line)] px-3 py-2.5 text-xs" placeholder="Optional note" /></label>
              {selectedOrder.order_status === "cancelled" && transactionType === "payment" && <p className="mt-3 rounded-lg bg-amber-50 p-2.5 text-[11px] leading-5 text-amber-800">Cancelled orders cannot accept new payments. Switch to Refund to record money returned.</p>}
              <button disabled={isPending || (selectedOrder.order_status === "cancelled" && transactionType === "payment")} type="submit" className="mt-4 w-full rounded-xl border border-[var(--navy)] px-3 py-2.5 text-xs font-bold text-[var(--navy)] disabled:opacity-50">{isPending ? "Saving..." : transactionType === "refund" ? "Record refund" : "Record payment"}</button>
            </form>
          </div>
        </div>
        {error && <p role="alert" className="mt-4 rounded-xl bg-red-50 p-3 text-xs text-red-700">{error}</p>}
        {success && <p role="status" className="mt-4 rounded-xl bg-emerald-50 p-3 text-xs text-emerald-700">{success}</p>}
      </section>}
    </div>
  );
}
