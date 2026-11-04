import Link from "next/link";
import { redirect } from "next/navigation";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import OrderManager, {
  type OrderRecord,
  type OrderCustomerChoice,
  type OrderProductChoice,
  type OrderItemRecord,
  type OrderTransactionRecord,
} from "./order-manager";

function LoadError({ message }: { message: string }) {
  return <main className="min-h-screen bg-[var(--surface)] p-6"><div className="mx-auto max-w-4xl rounded-2xl border border-[var(--line)] bg-white p-6"><h1 className="font-bold text-[var(--navy)]">Orders couldn't be loaded</h1><p className="mt-2 text-sm leading-6 text-slate-500">{message}</p><Link href="/" className="mt-4 inline-block text-sm font-semibold text-[var(--orange)]">Back to overview</Link></div></main>;
}

export default async function OrdersPage() {
  const supabase = await createSupabaseServerClient();
  const { data: claimsData, error: claimsError } = await supabase.auth.getClaims();
  const userId = claimsData?.claims?.sub;

  if (claimsError || typeof userId !== "string") redirect("/login");

  const { data: membership, error: membershipError } = await supabase
    .from("business_members")
    .select("business_id")
    .eq("user_id", userId)
    .limit(1)
    .maybeSingle();

  if (membershipError) return <LoadError message="We couldn't verify your business workspace. Refresh and try again." />;
  if (!membership?.business_id) redirect("/onboarding");

  const businessId = membership.business_id;
  const [ordersResult, customersResult, productsResult, stockResult] = await Promise.all([
    supabase.from("orders")
      .select("id, order_number, customer_id, customer_name, customer_phone, sales_channel, order_status, currency_code, subtotal_amount, discount_amount, delivery_fee, total_amount, expected_delivery_date, delivery_address, notes, created_at")
      .eq("business_id", businessId)
      .order("created_at", { ascending: false })
      .limit(100),
    supabase.from("customers")
      .select("id, name, phone_number, whatsapp_number, delivery_address")
      .eq("business_id", businessId)
      .order("name", { ascending: true }),
    supabase.from("products")
      .select("id, name, sku, selling_price, track_inventory, is_archived")
      .eq("business_id", businessId)
      .eq("is_archived", false)
      .order("name", { ascending: true }),
    supabase.from("product_stock_levels")
      .select("product_id, stock_on_hand")
      .eq("business_id", businessId),
  ]);

  if (ordersResult.error || customersResult.error || productsResult.error || stockResult.error) {
    return <LoadError message="We couldn't load the orders, customers or active products for this workspace. Refresh and try again." />;
  }

  const orderRows = ordersResult.data ?? [];
  const orderIds = orderRows.map((order) => order.id);

  let itemRows: OrderItemRecord[] = [];
  let transactionRows: OrderTransactionRecord[] = [];
  let financialRows: {
    order_id: string;
    amount_received: number | string;
    amount_refunded: number | string;
    net_amount_received: number | string;
    balance_due: number | string;
    payment_status: string;
  }[] = [];

  if (orderIds.length > 0) {
    const [itemsResult, transactionsResult, financialResult] = await Promise.all([
      supabase.from("order_items")
        .select("id, order_id, product_id, product_name, quantity, unit_price, line_total")
        .eq("business_id", businessId)
        .in("order_id", orderIds),
      supabase.from("payments")
        .select("id, order_id, transaction_type, amount, payment_method, reference, note, recorded_at")
        .eq("business_id", businessId)
        .in("order_id", orderIds)
        .order("recorded_at", { ascending: false }),
      supabase.from("order_financial_summary")
        .select("order_id, amount_received, amount_refunded, net_amount_received, balance_due, payment_status")
        .eq("business_id", businessId)
        .in("order_id", orderIds),
    ]);

    if (itemsResult.error || transactionsResult.error || financialResult.error) {
      return <LoadError message="We couldn't load the order items or payment summaries. Refresh and try again." />;
    }

    itemRows = (itemsResult.data ?? []).map((item) => ({
      ...item,
      quantity: Number(item.quantity),
      unit_price: Number(item.unit_price),
      line_total: Number(item.line_total),
    })) as OrderItemRecord[];

    transactionRows = (transactionsResult.data ?? []).map((transaction) => ({
      ...transaction,
      amount: Number(transaction.amount),
    })) as OrderTransactionRecord[];

    financialRows = (financialResult.data ?? []) as typeof financialRows;
  }

  const itemsByOrder = new Map<string, OrderItemRecord[]>();
  for (const item of itemRows) {
    const current = itemsByOrder.get(item.order_id) ?? [];
    current.push(item);
    itemsByOrder.set(item.order_id, current);
  }

  const transactionsByOrder = new Map<string, OrderTransactionRecord[]>();
  for (const transaction of transactionRows) {
    const current = transactionsByOrder.get(transaction.order_id) ?? [];
    current.push(transaction);
    transactionsByOrder.set(transaction.order_id, current);
  }

  const financialByOrder = new Map(financialRows.map((row) => [row.order_id, row]));
  const initialOrders: OrderRecord[] = orderRows.map((order) => {
    const financial = financialByOrder.get(order.id);
    return {
      ...order,
      subtotal_amount: Number(order.subtotal_amount),
      discount_amount: Number(order.discount_amount),
      delivery_fee: Number(order.delivery_fee),
      total_amount: Number(order.total_amount),
      amount_received: Number(financial?.amount_received ?? 0),
      amount_refunded: Number(financial?.amount_refunded ?? 0),
      net_amount_received: Number(financial?.net_amount_received ?? 0),
      balance_due: Number(financial?.balance_due ?? order.total_amount),
      payment_status: financial?.payment_status ?? (Number(order.total_amount) === 0 ? "no_payment_required" : "unpaid"),
      items: itemsByOrder.get(order.id) ?? [],
      transactions: transactionsByOrder.get(order.id) ?? [],
    };
  }) as OrderRecord[];

  const customers: OrderCustomerChoice[] = (customersResult.data ?? []) as OrderCustomerChoice[];
  const stockByProduct = new Map((stockResult.data ?? []).map((row) => [row.product_id, row.stock_on_hand]));
  const products: OrderProductChoice[] = (productsResult.data ?? []).map((product) => ({
    id: product.id,
    name: product.name,
    sku: product.sku,
    selling_price: Number(product.selling_price),
    track_inventory: product.track_inventory,
    stock_on_hand: product.track_inventory ? Number(stockByProduct.get(product.id) ?? 0) : null,
  }));

  return (
    <main className="min-h-screen bg-[var(--surface)] px-4 py-6 sm:px-8">
      <div className="mx-auto max-w-7xl">
        <Link href="/" className="text-sm font-semibold text-[var(--orange)]">← Back to overview</Link>
        <div className="mt-5">
          <p className="text-sm font-medium text-[var(--orange)]">Workspace</p>
          <h1 className="mt-1 text-3xl font-bold tracking-tight text-[var(--navy)]">Orders</h1>
          <p className="mt-2 max-w-2xl text-sm leading-6 text-slate-500">Record customer purchases, keep payment records accurate and follow each order through delivery.</p>
        </div>
        <div className="mt-7">
          <OrderManager initialOrders={initialOrders} customers={customers} products={products} />
        </div>
      </div>
    </main>
  );
}
