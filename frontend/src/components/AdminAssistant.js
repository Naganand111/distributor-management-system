import React, { useState, useEffect, useRef, useCallback } from "react";
import api from "../lib/api";
import { Skeleton, EmptyState, ConfirmModal } from "./ui";
import {
  FiSend, FiPlus, FiTrash2, FiMessageSquare, FiCpu, FiUser,
  FiCopy, FiRefreshCw, FiCheck, FiMenu, FiX, FiAlertCircle,
} from "react-icons/fi";

/* Matches the backend limit so the user is told before the request is sent. */
const MAX_LEN = 2000;
const CHARS_WARN_AT = 1800;

/* ---------- Scoped styles (single-file component, no new CSS asset) ---------- */
const STYLES = `
.aa-shell{display:flex;flex-direction:column;height:calc(100vh - 210px);min-height:460px;overflow:hidden}
.aa-header{display:flex;align-items:center;justify-content:space-between;gap:.75rem;padding:.75rem 1rem;border-bottom:1px solid var(--border);background:var(--surface);flex-wrap:wrap}
.aa-title{font-size:1rem;font-weight:700;letter-spacing:-.01em}
.aa-sub{font-size:.78rem;color:var(--text-muted);line-height:1.3}
.aa-dot{display:inline-block;width:7px;height:7px;border-radius:50%;background:var(--success);margin-right:.35rem;vertical-align:middle}
.aa-body{display:flex;flex:1;min-height:0}
.aa-side{width:290px;flex-shrink:0;border-right:1px solid var(--border);background:var(--surface);display:flex;flex-direction:column;min-height:0}
@media (max-width:991.98px){.aa-side{width:240px}}
.aa-side-scroll{flex:1;overflow-y:auto;padding:.5rem}
.aa-side-head{font-size:.7rem;font-weight:700;letter-spacing:.06em;text-transform:uppercase;color:var(--text-muted);padding:.5rem .5rem .25rem}
.aa-conv{display:flex;align-items:center;gap:.5rem;width:100%;text-align:left;border:0;background:transparent;padding:.5rem;border-radius:var(--radius-sm);color:var(--text-secondary);font-size:.83rem}
.aa-conv:hover{background:var(--surface-hover)}
.aa-conv.active{background:var(--brand-soft);color:var(--brand-strong);font-weight:600}
.aa-conv:focus-visible,.aa-msg-action:focus-visible,.aa-chip:focus-visible,.aa-sugg:focus-visible,.aa-send:focus-visible,.aa-iconbtn:focus-visible,.aa-ta:focus-visible{outline:2px solid var(--brand);outline-offset:2px}
.aa-conv-del{flex-shrink:0;color:var(--text-muted);background:none;border:0;padding:.15rem;line-height:1}
.aa-conv-del:hover{color:var(--danger)}
.aa-main{display:flex;flex-direction:column;flex:1;min-width:0;min-height:0;background:var(--surface-2)}
.aa-scroll{flex:1;overflow-y:auto;padding:1rem;scroll-behavior:smooth}
.aa-row{display:flex;margin-bottom:.85rem}
.aa-row.user{justify-content:flex-end}
.aa-bubble{max-width:min(78%,720px);border-radius:14px;padding:.7rem .9rem;border:1px solid var(--border);box-shadow:var(--shadow-sm);background:var(--surface)}
.aa-row.user .aa-bubble{background:var(--brand);color:#fff;border-color:var(--brand-strong)}
.aa-avatar{width:28px;height:28px;border-radius:8px;display:flex;align-items:center;justify-content:center;flex-shrink:0;background:var(--brand-soft);color:var(--brand-strong)}
.aa-row.user .aa-avatar{background:rgba(255,255,255,.22);color:#fff}
.aa-name{font-size:.72rem;font-weight:700;color:var(--text-muted);text-transform:uppercase;letter-spacing:.04em}
.aa-row.user .aa-name{color:rgba(255,255,255,.85)}
.aa-md{font-size:.9rem;line-height:1.6;overflow-wrap:anywhere}
.aa-md>*:last-child{margin-bottom:0}
.aa-md h1,.aa-md h2,.aa-md h3,.aa-md h4{font-size:.88rem;font-weight:700;margin:.85rem 0 .35rem;letter-spacing:.02em}
.aa-md ul,.aa-md ol{margin:.3rem 0;padding-left:1.15rem}
.aa-md li{margin:.15rem 0}
.aa-md code{background:var(--bg-alt);padding:.05rem .3rem;border-radius:4px;font-size:.85em}
.aa-md pre{background:var(--bg-alt);padding:.6rem;border-radius:var(--radius-sm);overflow-x:auto;font-size:.82rem;margin:.4rem 0}
.aa-md blockquote{border-left:3px solid var(--border-strong);margin:.4rem 0;padding-left:.6rem;color:var(--text-secondary)}
.aa-actions{display:flex;gap:.35rem;margin-top:.45rem;flex-wrap:wrap}
.aa-msg-action{display:inline-flex;align-items:center;gap:.3rem;font-size:.72rem;color:var(--text-muted);background:none;border:0;padding:.2rem .35rem;border-radius:5px}
.aa-msg-action:hover{background:var(--surface-hover);color:var(--text)}
.aa-card-grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(140px,1fr));gap:.5rem;margin-top:.6rem}
.aa-kpi{border:1px solid var(--border);border-radius:var(--radius-sm);background:var(--surface-2);padding:.5rem .6rem}
.aa-kpi-l{font-size:.7rem;font-weight:600;color:var(--text-muted);text-transform:capitalize}
.aa-kpi-v{font-size:1.05rem;font-weight:800;letter-spacing:-.01em}
.aa-panel{border:1px solid var(--border);border-left:3px solid var(--brand);border-radius:var(--radius-sm);background:var(--surface-2);padding:.6rem .75rem;margin-top:.6rem}
.aa-panel-h{font-size:.72rem;font-weight:800;letter-spacing:.06em;color:var(--brand-strong);margin-bottom:.4rem;text-transform:uppercase}
.aa-panel.alert{border-left-color:var(--warning);background:var(--warning-bg)}
.aa-panel.alert .aa-panel-h{color:var(--status-pending)}
.aa-kv{display:flex;justify-content:space-between;gap:1rem;font-size:.83rem;padding:.12rem 0}
.aa-kv span:first-child{color:var(--text-secondary)}
.aa-kv span:last-child{font-weight:700;overflow-wrap:anywhere;text-align:right}
.aa-tablewrap{margin-top:.6rem;border:1px solid var(--border);border-radius:var(--radius-sm);overflow-x:auto;background:var(--surface)}
.aa-table{width:100%;border-collapse:collapse;font-size:.82rem;min-width:320px}
.aa-table th{background:var(--surface-2);color:var(--text-secondary);font-weight:700;text-align:left;padding:.45rem .6rem;border-bottom:1px solid var(--border);white-space:nowrap;font-size:.75rem}
.aa-table td{padding:.45rem .6rem;border-bottom:1px solid var(--border)}
.aa-table tr:last-child td{border-bottom:0}
.aa-chips{display:flex;gap:.4rem;overflow-x:auto;padding:.5rem .75rem;border-top:1px solid var(--border);background:var(--surface)}
.aa-chip{flex-shrink:0;font-size:.76rem;padding:.3rem .65rem;border-radius:var(--radius-pill);border:1px solid var(--border-strong);background:var(--surface);color:var(--text-secondary);white-space:nowrap}
.aa-chip:hover:not(:disabled){background:var(--brand-soft);border-color:var(--brand);color:var(--brand-strong)}
.aa-chip:disabled{opacity:.5;cursor:not-allowed}
.aa-composer{border-top:1px solid var(--border);background:var(--surface);padding:.6rem .75rem}
.aa-ta-row{display:flex;align-items:flex-end;gap:.5rem;border:1px solid var(--border-strong);border-radius:var(--radius);background:var(--surface);padding:.4rem}
.aa-ta-row:focus-within{border-color:var(--brand);box-shadow:var(--ring)}
.aa-ta{flex:1;border:0;outline:0;resize:none;background:transparent;font-size:.9rem;line-height:1.5;padding:.35rem .45rem;max-height:140px;font-family:inherit;color:var(--text)}
.aa-send{border:0;border-radius:8px;background:var(--brand);color:#fff;width:36px;height:36px;display:flex;align-items:center;justify-content:center;flex-shrink:0}
.aa-send:disabled{background:var(--border-strong);cursor:not-allowed}
.aa-meta{display:flex;justify-content:space-between;gap:.5rem;font-size:.7rem;color:var(--text-muted);margin-top:.3rem}
.aa-iconbtn{border:1px solid var(--border);background:var(--surface);color:var(--text-secondary);border-radius:8px;width:32px;height:32px;display:flex;align-items:center;justify-content:center;flex-shrink:0}
.aa-iconbtn:hover{background:var(--surface-hover)}
.aa-sugg-grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(180px,1fr));gap:.6rem;width:100%;max-width:640px;margin-top:1rem}
.aa-sugg{text-align:left;border:1px solid var(--border);background:var(--surface);border-radius:var(--radius);padding:.7rem .8rem;box-shadow:var(--shadow-sm)}
.aa-sugg:hover:not(:disabled){border-color:var(--brand);background:var(--brand-soft)}
.aa-sugg-t{font-size:.85rem;font-weight:700;display:flex;align-items:center;gap:.4rem}
.aa-sugg-q{font-size:.76rem;color:var(--text-muted);margin-top:.15rem}
.aa-typing{display:inline-flex;gap:.28rem;align-items:center}
.aa-typing i{width:7px;height:7px;border-radius:50%;background:var(--text-muted);display:block;animation:aa-blink 1.3s infinite ease-in-out}
.aa-typing i:nth-child(2){animation-delay:.18s}
.aa-typing i:nth-child(3){animation-delay:.36s}
@keyframes aa-blink{0%,80%,100%{opacity:.25;transform:translateY(0)}40%{opacity:1;transform:translateY(-2px)}}
.aa-mobile-back{display:none}
@media (max-width:767.98px){
  .aa-side{position:absolute;inset:0 auto 0 0;z-index:20;width:min(84vw,300px);box-shadow:var(--shadow-lg)}
  .aa-shell{height:calc(100vh - 190px)}
  .aa-bubble{max-width:88%}
  .aa-scrim{position:absolute;inset:0;background:rgba(16,24,40,.35);z-index:15}
  .aa-mobile-back{display:flex}
}
.aa-rel{position:relative}
`;

/* ---------- Welcome suggestions ---------- */
const SUGGESTIONS = [
  { icon: "📊", label: "Today's Sales", query: "Show today's sales" },
  { icon: "📦", label: "Inventory", query: "Which products need restocking?" },
  { icon: "💰", label: "Payments", query: "Show outstanding payments" },
  { icon: "🛒", label: "Orders", query: "Show pending orders" },
  { icon: "📈", label: "Performance", query: "Give me a business summary" },
  { icon: "👥", label: "Customers", query: "How many customers do we have?" },
];

/* ---------- Quick prompts ---------- */
const QUICK_PROMPTS = [
  "Today's sales",
  "Business summary",
  "Pending orders",
  "Low stock",
  "Top products",
  "Outstanding payments",
];

/* ---------- Follow-ups, derived from the intent the backend reported ---------- */
const FOLLOW_UPS = {
  todays_sales: ["Compare with yesterday", "Show top products", "Show today's orders"],
  yesterday_sales: ["Compare with yesterday", "Show top products", "Show today's orders"],
  this_month_revenue: ["Compare this month with last month", "Show top products", "Show business alerts"],
  last_month_revenue: ["Compare this month with last month", "Show business alerts", "Show top products"],
  total_revenue: ["Show this month's revenue", "Show business alerts", "Show top products"],
  compare_months: ["Show this month's revenue", "Show last month's revenue", "Show today's sales"],
  gross_profit: ["Show this month's revenue", "Show business summary", "Show top products"],
  daily_performance: ["Compare with yesterday", "Show top products", "Show business alerts"],
  monthly_performance: ["Compare this month with last month", "Show top products", "Show business alerts"],
  sales_trend: ["Show this month's revenue", "Compare this month with last month", "Show today's sales"],
  top_products: ["Show the top 3", "Which products aren't moving?", "Show low stock products"],
  slow_products: ["Show top products", "Which products need restocking?", "Show inventory value"],
  low_stock: ["What products should I buy again?", "Show expired products", "Show inventory value"],
  reorder: ["Show low stock products", "Show expired products", "Show inventory value"],
  expired: ["Show damaged products", "Show low stock products", "Show inventory value"],
  damaged: ["Show expired products", "Show low stock products", "Show inventory value"],
  inventory_value: ["Show low stock products", "What products should I buy again?", "Show product overview"],
  inventory_health: ["Show low stock products", "What products should I buy again?", "Show inventory value"],
  product_overview: ["Show top products", "Which products aren't moving?", "Show low stock products"],
  payment_overview: ["Show outstanding payments", "Show pending orders", "Show order overview"],
  overdue: ["Show pending orders", "Show order overview", "Show business alerts"],
  pending_orders: ["Show today's orders", "Show outstanding payments", "How many total orders?"],
  cancelled_orders: ["Show pending orders", "Show order overview", "Show today's sales"],
  todays_orders: ["Show today's sales", "Show pending orders", "Show outstanding payments"],
  total_orders: ["Show today's orders", "Show pending orders", "Show order overview"],
  total_customers: ["How many customers bought today?", "Show top customers", "Give me customer insights"],
  todays_customers: ["How many customers do we have?", "Show top customers", "Show today's sales"],
  customer_overview: ["Show top customers", "How many customers bought today?", "Show business summary"],
  top_retailers: ["Show top customers", "How are our sales reps performing?", "Show business summary"],
  sales_rep_performance: ["Show top customers", "Show business summary", "Compare this month with last month"],
  business_summary: ["How many of those are pending?", "Which products need restocking?", "Show top products"],
  business_alerts: ["Show outstanding payments", "Show low stock products", "Show order overview"],
  order_overview: ["Show pending orders", "Show outstanding payments", "Show today's orders"],
  business_recommendations: ["What needs my attention?", "Show order overview", "Show inventory value"],
  clarification: ["Show today's sales", "Give me a business summary", "Show pending orders"],
  fallback: ["Show today's sales", "Give me a business summary", "Show business alerts"],
};

const followUpsFor = (intent) => FOLLOW_UPS[intent] || FOLLOW_UPS.fallback;

/* ---------- Presentation maps (never expose raw column names) ---------- */
const FIELD_LABELS = {
  name: "Product", product: "Product", product_name: "Product",
  qty: "Quantity", quantity: "Quantity", units: "Units",
  revenue: "Revenue", amount: "Amount", outstanding: "Outstanding Amount",
  paid_amount: "Paid", total_amount: "Total", discount: "Discount",
  profit: "Profit", margin: "Margin", value: "Value", stock_value: "Stock Value",
  orders: "Orders", order_count: "Orders", count: "Count",
  today_orders: "Orders Today", today_revenue: "Revenue Today", today_customers: "Customers Today",
  total_orders: "Total Orders", total_customers: "Total Customers",
  pending_orders: "Pending Orders", cancelled_orders: "Cancelled Orders",
  outstanding_orders: "Orders Outstanding", low_stock: "Low Stock",
  reorder_items: "Reorder", expired_products: "Expired", damaged_recent: "Damaged",
  customers: "Customers", top_product: "Top-Selling Product",
  slow_product: "Slowest-Moving Product", target: "Target", achieved: "Achieved",
  attainment: "Attainment", rep_name: "Sales Representative", retailer_name: "Customer",
  month: "Month", avg_order_value: "Average Order Value", growth: "Growth",
  last_month: "Last Month", this_month: "This Month",
  total_products: "Active Products", priced_products: "Products With Cost Price",
  inventory_cost_value: "Inventory Value (Cost)", inventory_retail_value: "Inventory Value (Retail)",
  yesterday_orders: "Orders Yesterday", yesterday_revenue: "Revenue Yesterday",
  yesterday_customers: "Customers Yesterday",
  this_month_orders: "Orders This Month", this_month_revenue: "Revenue This Month",
  this_month_customers: "Customers This Month",
  last_month_orders: "Orders Last Month", last_month_revenue: "Revenue Last Month",
  recorded_days: "Days With Recorded Sales", window_days: "Trend Window (Days)",
  first_day: "First Recorded Day", first_revenue: "First Day Revenue",
  latest_day: "Latest Recorded Day", latest_revenue: "Latest Day Revenue",
  best_day: "Best Recorded Day", best_revenue: "Best Day Revenue",
  new_customers_this_month: "New Customers This Month",
  customers_with_orders: "Customers With Orders", lifetime_revenue: "Lifetime Revenue",
  top_customer_name: "Top Customer", top_customer_orders: "Top Customer Orders",
  top_customer_spend: "Top Customer Spend", in_progress_orders: "In-Progress Orders",
};

const MONEY_FIELDS = new Set([
  "revenue", "amount", "outstanding", "paid_amount", "total_amount",
  "discount", "profit", "value", "stock_value", "today_revenue",
  "target", "achieved", "avg_order_value", "last_month", "this_month",
  "inventory_cost_value", "inventory_retail_value", "yesterday_revenue",
  "this_month_revenue", "first_revenue", "latest_revenue", "best_revenue",
  "lifetime_revenue", "top_customer_spend",
]);

const HIDDEN_TABLE_COLS = /(^id$|_id$|date|_at$|created|updated|user_id|order_id|product_id)/i;
const money = (v) =>
  "₹" + Number(v || 0).toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const isMoneyKey = (k) => MONEY_FIELDS.has(k) || /(revenue|amount|paid|value|profit|total|sales)/i.test(k);
const labelFor = (k) => FIELD_LABELS[k] || String(k).replace(/_/g, " ").replace(/^\w/, (c) => c.toUpperCase());
const num = (v) => (typeof v === "number" ? v : Number(v));

/* Grouped cards for the snapshot-style intents (sections 7 & 14). */
const PANEL_GROUPS = {
  business_summary: [
    { title: "📊 Sales", keys: ["today_orders", "today_revenue", "today_customers"] },
    { title: "📦 Operations", keys: ["pending_orders", "outstanding", "outstanding_orders"] },
    { title: "📦 Inventory", keys: ["low_stock", "reorder_items", "expired_products", "damaged_recent"] },
  ],
  order_overview: [
    { title: "🛒 Orders", keys: ["total_orders", "today_orders", "pending_orders", "cancelled_orders", "outstanding_orders"] },
  ],
  product_overview: [
    { title: "📦 Products", keys: ["top_product", "slow_product", "low_stock", "reorder_items", "expired_products", "damaged_recent"] },
  ],
  payment_overview: [
    { title: "💰 Payments", keys: ["count", "outstanding"] },
  ],
  daily_performance: [
    { title: "📊 Today", keys: ["today_orders", "today_revenue", "today_customers"] },
    { title: "📊 Yesterday", keys: ["yesterday_orders", "yesterday_revenue", "yesterday_customers"] },
  ],
  monthly_performance: [
    { title: "📈 This Month", keys: ["this_month_orders", "this_month_revenue", "this_month_customers"] },
    { title: "📈 Last Month", keys: ["last_month_orders", "last_month_revenue"] },
  ],
  sales_trend: [
    { title: "📈 Trend", keys: ["recorded_days", "window_days", "total_orders", "total_revenue"] },
    { title: "📈 Recorded Days", keys: ["first_day", "first_revenue", "latest_day", "latest_revenue", "best_day", "best_revenue"] },
  ],
  inventory_health: [
    { title: "📦 Inventory", keys: ["total_products", "low_stock", "reorder_items", "expired_products", "damaged_recent"] },
    { title: "💵 Inventory Value", keys: ["priced_products", "inventory_cost_value", "inventory_retail_value"] },
  ],
  customer_overview: [
    { title: "👥 Customers", keys: ["total_customers", "new_customers_this_month", "customers_with_orders", "this_month_customers", "lifetime_revenue"] },
    { title: "👤 Top Customer", keys: ["top_customer_name", "top_customer_orders", "top_customer_spend"] },
  ],
  business_alerts: [
    { title: "⚠️ Attention", keys: ["pending_orders", "outstanding", "outstanding_orders", "low_stock", "reorder_items", "expired_products", "damaged_recent"] },
  ],
  business_recommendations: [
    { title: "💡 Recommendations", keys: ["pending_orders", "in_progress_orders", "outstanding_orders", "outstanding", "low_stock", "reorder_items", "expired_products", "damaged_recent"] },
  ],
};

const presentable = (k, v) =>
  v !== null && v !== undefined && v !== "" && !(Array.isArray(v) && v.length === 0) && typeof v !== "object";

const formatValue = (k, v) => (isMoneyKey(k) && !Number.isNaN(num(v)) ? money(v) : String(v));

/* ---------- Cards + tables ---------- */
function DataViews({ data, intent }) {
  if (data === null || data === undefined) return null;

  if (Array.isArray(data)) {
    if (data.length === 0) return null; // never print "[]" or "No records returned"
    const rows = data.filter((r) => r && typeof r === "object");
    if (rows.length === 0) return null;
    const cols = Object.keys(rows[0]).filter(
      (k) => !HIDDEN_TABLE_COLS.test(k) && rows.some((r) => presentable(k, r[k]))
    );
    if (cols.length === 0) return null;
    return (
      <div className="aa-tablewrap">
        <table className="aa-table">
          <caption className="visually-hidden">Assistant result data</caption>
          <thead>
            <tr>{cols.map((c) => <th key={c} scope="col">{labelFor(c)}</th>)}</tr>
          </thead>
          <tbody>
            {rows.map((r, i) => (
              <tr key={i}>
                {cols.map((c) => {
                  const v = r[c];
                  const txt = presentable(c, v) ? formatValue(c, v) : "—";
                  return <td key={c}>{txt}</td>;
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    );
  }

  if (typeof data !== "object") return null;

  const groups = PANEL_GROUPS[intent];
  const isAlert = intent === "business_alerts";

  if (groups) {
    const panels = groups
      .map((g) => {
        const kv = g.keys
          .filter((k) => k in data && presentable(k, data[k]))
          .map((k) => [labelFor(k), formatValue(k, data[k])]);
        if (kv.length === 0) return null;
        return (
          <div key={g.title} className={`aa-panel${isAlert ? " alert" : ""}`}>
            <div className="aa-panel-h">{g.title}</div>
            {kv.map(([l, v]) => (
              <div className="aa-kv" key={l}><span>{l}</span><span>{v}</span></div>
            ))}
          </div>
        );
      })
      .filter(Boolean);
    return panels.length ? <div>{panels}</div> : null;
  }

  /* Generic: only render values that actually exist. */
  const numeric = Object.entries(data).filter(([k, v]) => presentable(k, v) && !Number.isNaN(num(v)) && typeof v !== "boolean");
  const textual = Object.entries(data).filter(([k, v]) => presentable(k, v) && typeof v === "string" && !Number.isNaN(num(v)));
  if (numeric.length === 0 && textual.length === 0) return null;

  return (
    <div className="aa-card-grid">
      {numeric.map(([k, v]) => (
        <div className="aa-kpi" key={k}>
          <div className="aa-kpi-l">{labelFor(k)}</div>
          <div className="aa-kpi-v">{formatValue(k, v)}</div>
        </div>
      ))}
      {textual.map(([k, v]) => (
        <div className="aa-kpi" key={k}>
          <div className="aa-kpi-l">{labelFor(k)}</div>
          <div className="aa-kpi-v">{String(v)}</div>
        </div>
      ))}
    </div>
  );
}

/* ---------- Minimal, XSS-safe markdown renderer (no new dependency) ----------
   Builds React elements only; never injects HTML. */
let mdSeq = 0;
const nextKey = (p) => `${p}-${(mdSeq += 1)}`;

function inline(text, kp) {
  const parts = [];
  const re = /(\*\*[^*]+\*\*|__[^_]+__|`[^`]+`|\*[^*\n]+\*|_[^_\n]+_)/g;
  let last = 0, m;
  while ((m = re.exec(text)) !== null) {
    if (m.index > last) parts.push(text.slice(last, m.index));
    const tok = m[0];
    if (tok.startsWith("**") || tok.startsWith("__")) parts.push(<strong key={nextKey(kp)}>{tok.slice(2, -2)}</strong>);
    else if (tok.startsWith("`")) parts.push(<code key={nextKey(kp)}>{tok.slice(1, -1)}</code>);
    else parts.push(<em key={nextKey(kp)}>{tok.slice(1, -1)}</em>);
    last = m.index + tok.length;
  }
  if (last < text.length) parts.push(text.slice(last));
  return parts;
}

function Markdown({ text }) {
  if (typeof text !== "string" || !text.trim()) return null;
  const lines = text.replace(/\r\n/g, "\n").split("\n");
  const out = [];
  let i = 0;

  while (i < lines.length) {
    const line = lines[i];

    if (line.trim() === "") { i += 1; continue; }

    /* fenced code */
    if (/^\s*```/.test(line)) {
      const buf = [];
      i += 1;
      while (i < lines.length && !/^\s*```/.test(lines[i])) { buf.push(lines[i]); i += 1; }
      i += 1;
      out.push(<pre key={nextKey("pre")}><code>{buf.join("\n")}</code></pre>);
      continue;
    }

    /* heading */
    const h = line.match(/^\s*(#{1,4})\s+(.*)$/);
    if (h) {
      const lvl = Math.min(h[1].length, 4);
      const Tag = `h${lvl}`;
      out.push(<Tag key={nextKey("h")}>{inline(h[2], "h")}</Tag>);
      i += 1;
      continue;
    }

    /* blockquote */
    if (/^\s*>\s?/.test(line)) {
      const buf = [];
      while (i < lines.length && /^\s*>\s?/.test(lines[i])) { buf.push(lines[i].replace(/^\s*>\s?/, "")); i += 1; }
      out.push(<blockquote key={nextKey("q")}>{inline(buf.join(" "), "q")}</blockquote>);
      continue;
    }

    /* bullet list — the backend answers use "•" as well as "-" */
    if (/^\s*[-*•]\s+/.test(line)) {
      const items = [];
      while (i < lines.length && /^\s*[-*•]\s+/.test(lines[i])) {
        items.push(lines[i].replace(/^\s*[-*•]\s+/, ""));
        i += 1;
      }
      out.push(
        <ul key={nextKey("ul")}>
          {items.map((it, n) => <li key={n}>{inline(it, "li")}</li>)}
        </ul>
      );
      continue;
    }

    /* numbered list */
    if (/^\s*\d+[.)]\s+/.test(line)) {
      const items = [];
      while (i < lines.length && /^\s*\d+[.)]\s+/.test(lines[i])) {
        items.push(lines[i].replace(/^\s*\d+[.)]\s+/, ""));
        i += 1;
      }
      out.push(
        <ol key={nextKey("ol")}>
          {items.map((it, n) => <li key={n}>{inline(it, "oli")}</li>)}
        </ol>
      );
      continue;
    }

    /* paragraph: join soft-wrapped lines */
    const buf = [line];
    i += 1;
    while (
      i < lines.length &&
      lines[i].trim() !== "" &&
      !/^\s*(```|#{1,4}\s|>|[-*•]\s|\d+[.)]\s)/.test(lines[i])
    ) {
      buf.push(lines[i]);
      i += 1;
    }
    out.push(<p key={nextKey("p")} className="mb-2">{inline(buf.join(" "), "p")}</p>);
  }

  return <div className="aa-md">{out}</div>;
}

/* ---------- Helpers ---------- */
let uid = 0;
const nextId = () => `m${(uid += 1)}`;

const startOfDay = (d) => { const x = new Date(d); x.setHours(0, 0, 0, 0); return x; };
const dayKey = (d) => startOfDay(d).getTime();
const groupConversations = (list) => {
  const now = new Date();
  const buckets = { Today: [], Yesterday: [], Earlier: [] };
  for (const c of list) {
    const t = dayKey(c.updated_at || c.created_at);
    if (t === dayKey(now)) buckets.Today.push(c);
    else if (t === dayKey(new Date(now.getTime() - 864e5))) buckets.Yesterday.push(c);
    else buckets.Earlier.push(c);
  }
  return Object.entries(buckets).filter(([, v]) => v.length > 0);
};

/* Only user-facing backend messages; never surface internals. */
function friendlyError(err) {
  const status = err?.response?.status;
  const body = err?.response?.data;
  if (status === 429) return "You've reached the request limit for now. Please wait a few minutes and try again.";
  /* Role/permission rejection: say so plainly instead of echoing whatever the
     auth middleware replied with. */
  if (status === 403) return "You don't have permission to use the assistant. Please sign in with an authorised admin account.";
  if (status === 413) return "That question is too long. Please shorten it and try again.";
  /* The assistant runs several aggregates, so it is bounded client-side too. */
  if (err?.code === "ECONNABORTED") return "That took too long to answer. Please try again.";
  /* 5xx messages come from our own stack, so they are never echoed back. */
  if (status >= 500) return "Sorry, I couldn't process that request. Please try again.";
  if (body?.error && typeof body.error === "string" && body.error.length < 200 && !/sql|stack|at .*\(/i.test(body.error)) {
    return body.error;
  }
  if (!err?.response) return "I couldn't reach the assistant service. Please check your connection and try again.";
  return "Sorry, I couldn't process that request. Please try again.";
}

const parseMeta = (row) => {
  if (!row || row.role !== "assistant") return { role: row?.role || "assistant", content: row?.content || "" };
  let meta = null;
  if (row.meta) {
    try { meta = typeof row.meta === "string" ? JSON.parse(row.meta) : row.meta; } catch { meta = null; }
  }
  return {
    role: "assistant",
    content: row.content || "",
    intent: meta?.intent || null,
    data: meta && meta.data !== undefined ? meta.data : null,
  };
};

/* =======================================================================
   COMPONENT
======================================================================= */
export default function AdminAssistant() {
  const [conversations, setConversations] = useState([]);
  const [activeId, setActiveId] = useState(null);
  const [messages, setMessages] = useState([]);
  const [input, setInput] = useState("");
  const [thinking, setThinking] = useState(false);
  const [loadingConvs, setLoadingConvs] = useState(true);
  const [loadingMsgs, setLoadingMsgs] = useState(false);
  const [error, setError] = useState("");
  const [copied, setCopied] = useState(null);
  const [lastUser, setLastUser] = useState(null);
  const [pendingDelete, setPendingDelete] = useState(null);
  const [confirmClear, setConfirmClear] = useState(false);
  const [sidebarOpen, setSidebarOpen] = useState(
    () => (typeof window === "undefined" ? true : window.innerWidth >= 768)
  );

  const bottomRef = useRef(null);
  const scrollRef = useRef(null);
  const stickRef = useRef(true);
  const taRef = useRef(null);
  /* Set when we create/switch to a conversation ourselves, so the effect below
     does not immediately refetch and risk replacing the transcript we just built. */
  const skipNextLoadRef = useRef(false);

  /* ---------- Conversations ---------- */
  const loadConvs = useCallback(async () => {
    setLoadingConvs(true);
    try {
      const res = await api.get("/ai/conversations");
      const list = Array.isArray(res.data) ? res.data : [];
      setConversations(list);
      /* Never clear a conversation we are already viewing just because the
         refreshed list has not caught up yet — that would wipe the transcript. */
      setActiveId((cur) => (cur ? cur : list.length ? list[0].id : null));
    } catch {
      setError("Sorry, I couldn't load your conversations. Please try again.");
    } finally {
      setLoadingConvs(false);
    }
  }, []);

  useEffect(() => { loadConvs(); }, [loadConvs]);

  const loadMessages = useCallback(async (id) => {
    setLoadingMsgs(true);
    setError("");
    try {
      const res = await api.get(`/ai/conversations/${id}/messages`);
      const list = Array.isArray(res.data) ? res.data : [];
      setMessages(list.map((r) => ({ _id: nextId(), ...parseMeta(r) })));
    } catch {
      setError("Sorry, I couldn't load this conversation. Please try again.");
    } finally {
      setLoadingMsgs(false);
    }
  }, []);

  useEffect(() => {
    if (skipNextLoadRef.current) {
      skipNextLoadRef.current = false;
      return;
    }
    if (activeId) loadMessages(activeId);
    else { setMessages([]); setLastUser(null); }
  }, [activeId, loadMessages]);

  /* ---------- Auto-scroll: only when already near the bottom ---------- */
  const onScroll = useCallback(() => {
    const el = scrollRef.current;
    if (!el) return;
    stickRef.current = el.scrollHeight - el.scrollTop - el.clientHeight < 90;
  }, []);

  useEffect(() => {
    if (stickRef.current) bottomRef.current?.scrollIntoView?.({ behavior: "smooth", block: "end" });
  }, [messages, thinking]);

  /* ---------- Send ---------- */
  const send = useCallback(
    async (text) => {
      const message = (text ?? input).trim();
      if (!message || thinking) return;
      if (message.length > MAX_LEN) {
        setError(`Please keep your question under ${MAX_LEN} characters.`);
        return;
      }

      setThinking(true);
      setError("");
      setLastUser(message);
      stickRef.current = true;
      setMessages((m) => [...m, { _id: nextId(), role: "user", content: message }]);
      setInput("");

      try {
        const res = await api.post("/ai/query", { message, conversationId: activeId });
        const payload = res?.data?.data;
        if (!payload || typeof payload.answer !== "string") throw new Error("malformed response");
        setMessages((m) => [
          ...m,
          {
            _id: nextId(),
            role: "assistant",
            content: payload.answer,
            data: payload.data ?? null,
            intent: payload.intent || null,
          },
        ]);
        if (payload.conversationId && payload.conversationId !== activeId) {
          skipNextLoadRef.current = true;
          setActiveId(payload.conversationId);
        }
        /* Refresh the sidebar in the background; do not block the input on it. */
        loadConvs();
      } catch (err) {
        setMessages((m) => [
          ...m,
          { _id: nextId(), role: "assistant", content: friendlyError(err), _error: true, intent: "error" },
        ]);
      } finally {
        setThinking(false);
      }
    },
    [activeId, input, loadConvs, thinking]
  );

  /* ---------- Conversation actions ---------- */
  const newChat = () => {
    setActiveId(null);
    setMessages([]);
    setInput("");
    setError("");
    setLastUser(null);
    setSidebarOpen(false);
    taRef.current?.focus();
  };

  const askClear = () => {
    if (!activeId && messages.length === 0) { newChat(); return; }
    setConfirmClear(true);
  };

  const clearChat = async () => {
    setConfirmClear(false);
    if (!activeId) { newChat(); return; }
    try {
      await api.delete(`/ai/conversations/${activeId}`);
      newChat();
      await loadConvs();
    } catch {
      setError("Sorry, I couldn't clear this conversation. Please try again.");
    }
  };

  const deleteConv = async (id) => {
    setPendingDelete(null);
    try {
      await api.delete(`/ai/conversations/${id}`);
      if (activeId === id) newChat();
      await loadConvs();
    } catch {
      setError("Sorry, I couldn't delete that conversation. Please try again.");
    }
  };

  /* ---------- Copy ---------- */
  const copyAnswer = async (text, id) => {
    try {
      if (navigator.clipboard?.writeText) await navigator.clipboard.writeText(text);
      else {
        const ta = document.createElement("textarea");
        ta.value = text;
        ta.style.position = "fixed";
        ta.style.opacity = "0";
        document.body.appendChild(ta);
        ta.select();
        document.execCommand("copy");
        document.body.removeChild(ta);
      }
      setCopied(id);
      setTimeout(() => setCopied((c) => (c === id ? null : c)), 1600);
    } catch {
      setError("Sorry, I couldn't copy that response.");
    }
  };

  /* ---------- Input helpers ---------- */
  /* Reads the live textarea value so sending never depends on a stale render. */
  const sendCurrent = () => send(taRef.current?.value ?? input);

  const onKeyDown = (e) => {
    if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); sendCurrent(); }
  };

  const onChange = (e) => {
    setInput(e.target.value);
    const el = e.target;
    el.style.height = "auto";
    el.style.height = `${Math.min(el.scrollHeight, 140)}px`;
  };

  const lastAssistant = messages.length ? [...messages].reverse().find((m) => m.role === "assistant") : null;
  const showWelcome = !loadingMsgs && messages.length === 0;
  const groups = groupConversations(conversations);

  return (
    <div className="aa-shell aa-rel">
      <style>{STYLES}</style>

      {/* ---------- Header ---------- */}
      <div className="aa-header">
        <div className="d-flex align-items-center gap-2 min-w-0">
          <button
            className="aa-iconbtn aa-mobile-back"
            onClick={() => setSidebarOpen((v) => !v)}
            aria-label={sidebarOpen ? "Hide conversations" : "Show conversations"}
            aria-expanded={sidebarOpen}
          >
            {sidebarOpen ? <FiX /> : <FiMenu />}
          </button>
          <div className="min-w-0">
            <div className="aa-title">AI Business Assistant</div>
            <div className="aa-sub">
              <span className="aa-dot" aria-hidden="true" />
              <span title="The assistant interface is available.">Online</span>
              {" — "}Ask questions about sales, orders, customers, inventory and payments.
            </div>
          </div>
        </div>

        <div className="d-flex align-items-center gap-2">
          <button className="btn btn-sm btn-outline-secondary" onClick={() => setSidebarOpen((v) => !v)} aria-expanded={sidebarOpen}>
            <FiMessageSquare className="me-1" /> History
          </button>
          <button className="btn btn-sm btn-outline-secondary" onClick={askClear} disabled={!activeId && messages.length === 0}>
            <FiTrash2 className="me-1" /> Clear
          </button>
          <button className="btn btn-sm btn-primary" onClick={newChat}>
            <FiPlus className="me-1" /> New Chat
          </button>
        </div>
      </div>

      {/* ---------- Body ---------- */}
      <div className="aa-body">
        {/* Sidebar */}
        {sidebarOpen && <div className="aa-scrim d-md-none" onClick={() => setSidebarOpen(false)} aria-hidden="true" />}
        <aside className={`aa-side ${sidebarOpen ? "" : "hidden"}`} aria-label="Conversation history">
          <div className="aa-side-head d-flex justify-content-between align-items-center">
            <span>Recent conversations</span>
            <button className="btn btn-sm btn-link p-0" onClick={newChat} aria-label="Start a new conversation">
              <FiPlus />
            </button>
          </div>
          <div className="aa-side-scroll">
            {loadingConvs ? (
              <Skeleton type="card" rows={4} />
            ) : conversations.length === 0 ? (
              <EmptyState title="No conversations" subtitle="Ask your first question to begin" />
            ) : (
              groups.map(([label, items]) => (
                <div key={label}>
                  <div className="aa-side-head">{label}</div>
                  {items.map((c) => (
                    <div key={c.id} className={`aa-conv ${c.id === activeId ? "active" : ""}`}>
                      <button
                        className="aa-conv flex-fill border-0 bg-transparent p-0 text-start"
                        onClick={() => { setActiveId(c.id); setSidebarOpen(false); }}
                        aria-current={c.id === activeId ? "true" : undefined}
                      >
                        <FiMessageSquare className="me-1 flex-shrink-0" />
                        <span className="text-truncate">{c.title || "New conversation"}</span>
                        {c.message_count > 0 && <span className="ms-auto small text-muted">{c.message_count}</span>}
                      </button>
                      <button
                        className="aa-conv-del"
                        onClick={() => setPendingDelete(c)}
                        aria-label={`Delete conversation: ${c.title || "New conversation"}`}
                      >
                        <FiTrash2 />
                      </button>
                    </div>
                  ))}
                </div>
              ))
            )}
          </div>
        </aside>

        {/* Chat */}
        <main className="aa-main">
          {error && (
            <div className="alert alert-danger d-flex justify-content-between align-items-center m-3 mb-0 py-2" role="alert">
              <span className="small">{error}</span>
              <button className="btn btn-sm btn-outline-danger" onClick={() => setError("")}>Dismiss</button>
            </div>
          )}

          <div className="aa-scroll" ref={scrollRef} onScroll={onScroll} role="log" aria-live="polite" aria-label="Conversation">
            {loadingMsgs ? (
              <Skeleton type="card" rows={3} />
            ) : showWelcome ? (
              <div className="d-flex flex-column align-items-center justify-content-center h-100 text-center px-2">
                <div className="aa-avatar mb-2" style={{ width: 46, height: 46 }}><FiCpu size={22} /></div>
                <h5 className="fw-bold mb-1">How can I help with your business?</h5>
                <p className="text-muted small mb-0">Ask me about sales, inventory, orders, customers or payments.</p>
                <div className="aa-sugg-grid">
                  {SUGGESTIONS.map((s) => (
                    <button key={s.label} className="aa-sugg" onClick={() => send(s.query)} disabled={thinking}>
                      <div className="aa-sugg-t"><span aria-hidden="true">{s.icon}</span>{s.label}</div>
                      <div className="aa-sugg-q">{s.query}</div>
                    </button>
                  ))}
                </div>
              </div>
            ) : (
              messages.map((m) =>
                m.role === "user" ? (
                  <div className="aa-row user" key={m._id}>
                    <div className="d-flex align-items-start gap-2">
                      <div className="aa-bubble">
                        <div className="d-flex align-items-center gap-2 mb-1">
                          <div className="aa-avatar" style={{ width: 22, height: 22 }}><FiUser size={12} /></div>
                          <span className="aa-name">You</span>
                        </div>
                        <div style={{ fontSize: ".9rem", lineHeight: 1.6, overflowWrap: "anywhere" }}>{m.content}</div>
                      </div>
                    </div>
                  </div>
                ) : (
                  <div className="aa-row" key={m._id}>
                    <div style={{ minWidth: 0, maxWidth: "min(88%,760px)" }}>
                      <div className="d-flex align-items-start gap-2">
                        <div className="aa-avatar"><FiCpu size={14} /></div>
                        <div className="aa-bubble flex-fill" style={{ minWidth: 0 }}>
                          <div className="aa-name mb-1">Assistant</div>

                          {m._error ? (
                            <div className="d-flex align-items-start gap-2">
                              <FiAlertCircle className="text-danger flex-shrink-0 mt-1" />
                              <div className="flex-fill">
                                <div style={{ fontSize: ".9rem", lineHeight: 1.6 }}>{m.content}</div>
                                {lastUser && (
                                  <div className="mt-2">
                                    <button className="btn btn-sm btn-outline-secondary" onClick={() => send(lastUser)} disabled={thinking}>
                                      <FiRefreshCw className="me-1" /> Try again
                                    </button>
                                  </div>
                                )}
                              </div>
                            </div>
                          ) : (
                            <Markdown text={m.content} />
                          )}

                          <DataViews data={m.data} intent={m.intent} />

                          {!m._error && (
                            <div className="aa-actions">
                              <button className="aa-msg-action" onClick={() => copyAnswer(m.content, m._id)} aria-label="Copy response">
                                {copied === m._id ? <><FiCheck size={12} /> Copied</> : <><FiCopy size={12} /> Copy</>}
                              </button>
                              <button
                                className="aa-msg-action"
                                onClick={() => {
                                  const idx = messages.indexOf(m);
                                  for (let k = idx - 1; k >= 0; k -= 1) {
                                    if (messages[k].role === "user") { send(messages[k].content); return; }
                                  }
                                }}
                                disabled={thinking}
                                aria-label="Retry this question"
                              >
                                <FiRefreshCw size={12} /> Retry
                              </button>
                            </div>
                          )}
                        </div>
                      </div>
                    </div>
                  </div>
                )
              )
            )}

            {thinking && (
              <div className="aa-row">
                <div className="d-flex align-items-start gap-2">
                  <div className="aa-avatar"><FiCpu size={14} /></div>
                  <div className="aa-bubble">
                    <div className="aa-name mb-1">Assistant</div>
                    <div className="d-flex align-items-center gap-2">
                      <span className="aa-typing" aria-hidden="true"><i /><i /><i /></span>
                      <span className="small text-muted">Thinking…</span>
                    </div>
                  </div>
                </div>
              </div>
            )}

            <div ref={bottomRef} />
          </div>

          {/* Quick prompts — only once the assistant is idle, so they are never shown disabled */}
          {messages.length > 0 && !thinking && (
            <div className="aa-chips" aria-label="Quick prompts">
              {QUICK_PROMPTS.map((q) => (
                <button key={q} className="aa-chip" onClick={() => send(q)} disabled={thinking}>
                  {q}
                </button>
              ))}
            </div>
          )}

          {/* Follow-ups (last assistant response only) */}
          {!loadingMsgs && lastAssistant && !lastAssistant._error && !thinking && (
            <div className="aa-chips" aria-label="Follow-up questions">
              {followUpsFor(lastAssistant.intent).map((q) => (
                <button key={q} className="aa-chip" onClick={() => send(q)} disabled={thinking}>
                  {q}
                </button>
              ))}
            </div>
          )}

          {/* Composer */}
          <div className="aa-composer">
            <div className="aa-ta-row">
              <label htmlFor="aa-input" className="visually-hidden">Ask your business assistant</label>
              <textarea
                id="aa-input"
                ref={taRef}
                className="aa-ta"
                rows={1}
                placeholder="Ask about sales, inventory, orders..."
                value={input}
                onChange={onChange}
                onKeyDown={onKeyDown}
                disabled={thinking}
                maxLength={MAX_LEN}
                aria-label="Ask about sales, inventory, orders"
              />
              <button
                className="aa-send"
                onClick={sendCurrent}
                disabled={thinking || !input.trim()}
                aria-label="Send message"
                title="Send (Enter)"
              >
                <FiSend />
              </button>
            </div>
            <div className="aa-meta">
              <span>Enter to send · Shift + Enter for a new line</span>
              {input.length >= CHARS_WARN_AT && (
                <span style={{ color: input.length > MAX_LEN - 100 ? "var(--danger)" : "var(--text-muted)" }}>
                  {input.length} / {MAX_LEN}
                </span>
              )}
            </div>
          </div>
        </main>
      </div>

      <ConfirmModal
        open={!!pendingDelete}
        danger
        title="Delete this conversation?"
        message={pendingDelete ? `"${pendingDelete.title || "New conversation"}" and all of its messages will be permanently removed.` : ""}
        confirmLabel="Delete"
        onConfirm={() => deleteConv(pendingDelete.id)}
        onCancel={() => setPendingDelete(null)}
      />

      <ConfirmModal
        open={confirmClear}
        danger
        title="Clear this conversation?"
        message="The current conversation and all of its messages will be permanently removed."
        confirmLabel="Clear"
        onConfirm={clearChat}
        onCancel={() => setConfirmClear(false)}
      />
    </div>
  );
}
