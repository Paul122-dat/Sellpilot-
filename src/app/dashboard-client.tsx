"use client";
import { useState } from "react";
import { signOut } from "@/app/auth/actions";
import { Activity, Bell, Boxes, ChevronDown, CircleHelp, CreditCard, LayoutDashboard, Menu, MessageSquareText, Package, Plus, Search, Settings, ShoppingBag, Users, Wallet, X } from "lucide-react";

const navigation = [
  { label: "Overview", icon: LayoutDashboard }, { label: "Orders", icon: ShoppingBag },
  { label: "Customers", icon: Users }, { label: "Products & stock", icon: Boxes },
  { label: "Finances", icon: Wallet }, { label: "AI assistant", icon: MessageSquareText }
];
const metrics = [
  { label: "Orders", note: "No orders recorded yet", icon: ShoppingBag },
  { label: "Payments collected", note: "Based on recorded payments", icon: CreditCard },
  { label: "Outstanding", note: "Unpaid order balances", icon: Activity },
  { label: "Products", note: "Your product catalogue", icon: Package }
];

export default function DashboardClient({ userName }: { userName: string }) {
  const [active, setActive] = useState("Overview");
  const [menuOpen, setMenuOpen] = useState(false);
  return <main className="min-h-screen bg-[var(--surface)]">
    <aside className={`fixed inset-y-0 left-0 z-30 flex w-64 flex-col border-r border-[var(--line)] bg-white p-5 transition-transform md:translate-x-0 ${menuOpen ? "translate-x-0" : "-translate-x-full"}`}>
      <div className="flex items-center justify-between"><a href="/" className="text-2xl font-black tracking-tight text-[var(--navy)]">Sell<span className="text-[var(--orange)]">Pilot</span></a><button className="p-2 md:hidden" onClick={() => setMenuOpen(false)} aria-label="Close menu"><X size={20}/></button></div>
      <p className="mt-1 text-xs text-slate-500">Your business, in control.</p>
      <div className="mt-10"><p className="mb-3 px-3 text-[10px] font-bold uppercase tracking-[.18em] text-slate-400">Workspace</p><nav className="space-y-1">{navigation.map(({label,icon:Icon}) => <button key={label} onClick={() => {setActive(label);setMenuOpen(false);}} className={`flex w-full items-center gap-3 rounded-xl px-3 py-3 text-left text-sm font-semibold ${active===label?"bg-orange-50 text-[var(--orange)]":"text-slate-600 hover:bg-slate-50"}`}><Icon size={18}/>{label}{label==="AI assistant"&&<span className="ml-auto rounded-full bg-orange-100 px-2 py-0.5 text-[10px] text-orange-700">AI</span>}</button>)}</nav></div>
      <div className="mt-auto space-y-1 border-t border-[var(--line)] pt-4"><button className="flex w-full items-center gap-3 rounded-xl px-3 py-3 text-sm text-slate-600"><Settings size={18}/>Settings</button><button className="flex w-full items-center gap-3 rounded-xl px-3 py-3 text-sm text-slate-600"><CircleHelp size={18}/>Help & support</button><form action={signOut}><button type="submit" className="flex w-full items-center gap-3 rounded-xl px-3 py-3 text-sm font-semibold text-slate-600 hover:bg-slate-50">Sign out</button></form><div className="mt-3 rounded-xl bg-slate-50 p-3"><p className="text-xs font-bold text-[var(--navy)]">Getting started</p><p className="mt-1 text-xs leading-5 text-slate-500">Your workspace is being prepared.</p></div></div>
    </aside>
    {menuOpen&&<button className="fixed inset-0 z-20 bg-slate-950/30 md:hidden" onClick={()=>setMenuOpen(false)} aria-label="Close overlay"/>}
    <section className="min-h-screen md:pl-64">
      <header className="sticky top-0 z-10 flex h-[72px] items-center justify-between border-b border-[var(--line)] bg-white/95 px-4 backdrop-blur sm:px-8">
        <div className="flex items-center gap-3"><button className="p-2 md:hidden" onClick={()=>setMenuOpen(true)} aria-label="Open menu"><Menu size={21}/></button><div><p className="text-xs text-slate-500">Workspace / {active}</p><h1 className="text-lg font-bold text-[var(--navy)]">{active}</h1></div></div>
        <div className="flex items-center gap-2 sm:gap-4"><button className="hidden items-center gap-2 rounded-xl border border-[var(--line)] px-3 py-2 text-xs text-slate-500 sm:flex"><Search size={15}/>Search</button><button className="relative rounded-xl p-2 text-slate-500" aria-label="Notifications"><Bell size={19}/></button><button className="flex items-center gap-2 rounded-xl border border-[var(--line)] p-1.5 pr-2"><span className="grid h-8 w-8 place-items-center rounded-lg bg-[var(--navy)] text-xs font-bold text-white">SP</span><ChevronDown size={15}/></button></div>
      </header>
      <div className="mx-auto max-w-6xl p-4 sm:p-8">
        <div className="flex flex-col justify-between gap-4 sm:flex-row sm:items-end"><div><p className="text-sm font-medium text-[var(--orange)]">Your business, at a glance</p><h2 className="mt-1 text-2xl font-bold tracking-tight text-[var(--navy)] sm:text-3xl">Welcome back{userName ? `, ${userName}` : ""}</h2><p className="mt-2 max-w-xl text-sm leading-6 text-slate-500">A clearer way to manage your orders, customers, products and money — all in one place.</p></div><button className="inline-flex items-center justify-center gap-2 rounded-xl bg-[var(--orange)] px-4 py-3 text-sm font-bold text-white"><Plus size={17}/>Create first order</button></div>
        <div className="mt-8 rounded-2xl border border-orange-100 bg-orange-50/70 p-4 sm:p-5"><div className="flex items-start gap-3"><div className="rounded-xl bg-white p-2 text-[var(--orange)]"><Activity size={19}/></div><div><p className="text-sm font-bold text-[var(--navy)]">Your workspace is ready for setup</p><p className="mt-1 text-xs leading-5 text-slate-600">Figures are intentionally blank. SellPilot will show business totals only after real records are saved — no invented demo revenue.</p></div></div></div>
        <div className="mt-6 grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">{metrics.map(({label,note,icon:Icon})=><article key={label} className="rounded-2xl border border-[var(--line)] bg-white p-5 shadow-sm"><div className="flex items-center justify-between"><p className="text-sm font-medium text-slate-500">{label}</p><span className="rounded-xl bg-slate-50 p-2 text-slate-500"><Icon size={18}/></span></div><p className="mt-4 text-3xl font-bold text-[var(--navy)]">—</p><p className="mt-2 text-xs text-slate-400">{note}</p></article>)}</div>
        <div className="mt-6 grid gap-5 lg:grid-cols-[1.5fr_1fr]"><section className="rounded-2xl border border-[var(--line)] bg-white p-5 sm:p-6"><h3 className="font-bold text-[var(--navy)]">Business activity</h3><p className="mt-1 text-xs text-slate-500">Your recorded activity will appear here</p><div className="mt-8 grid min-h-48 place-items-center rounded-xl border border-dashed border-slate-200 bg-slate-50/70 p-6 text-center"><div><Activity size={22} className="mx-auto text-slate-400"/><p className="mt-3 text-sm font-semibold text-slate-700">Your activity starts here</p><p className="mt-1 max-w-xs text-xs leading-5 text-slate-500">Record orders and payments to see meaningful business trends.</p></div></div></section><section className="rounded-2xl border border-[var(--line)] bg-white p-5 sm:p-6"><h3 className="font-bold text-[var(--navy)]">Quick actions</h3><p className="mt-1 text-xs text-slate-500">Keep everyday tasks close.</p><div className="mt-5 space-y-3">{[{title:"Add an order",detail:"Record a customer purchase",icon:ShoppingBag},{title:"Add a customer",detail:"Build your customer list",icon:Users},{title:"Add a product",detail:"Set up your product catalogue",icon:Package}].map(({title,detail,icon:Icon})=><button key={title} className="flex w-full items-center gap-3 rounded-xl border border-[var(--line)] p-3 text-left"><span className="rounded-lg bg-slate-50 p-2.5 text-[var(--navy)]"><Icon size={17}/></span><span className="min-w-0 flex-1"><span className="block text-sm font-semibold text-slate-700">{title}</span><span className="mt-0.5 block text-xs text-slate-500">{detail}</span></span><Plus size={16} className="text-[var(--orange)]"/></button>)}</div></section></div>
        <footer className="mt-8 border-t border-[var(--line)] py-5 text-xs text-slate-400">SellPilot · Foundation build · Database not connected</footer>
      </div>
    </section>
  </main>;
}
