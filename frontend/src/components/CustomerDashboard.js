import React, { useEffect, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import api from "../lib/api";
import { formatINR, formatDate, timeAgo } from "../lib/utils";
import { StatusBadge, StatCard, PageTransition, AnimatedNumber, EmptyState } from "./ui";
import { FiPackage, FiClock, FiSettings, FiCheckCircle, FiDollarSign, FiArrowRight, FiBell, FiPieChart, FiAward, FiMessageCircle, FiShoppingBag, FiCreditCard, FiFileText, FiRefreshCw } from "react-icons/fi";
import { AreaChart, Area, XAxis, YAxis, Tooltip, CartesianGrid, ResponsiveContainer } from "recharts";

const isPaid = (s) => s === "paid";

const AI_QUICK_PROMPTS = [
  { label: "My Orders", query: "Show my orders", icon: <FiShoppingBag /> },
  { label: "Track Order", query: "Show my latest order", icon: <FiClock /> },
  { label: "My Payments", query: "Show my payments", icon: <FiCreditCard /> },
  { label: "My Invoices", query: "Show my invoices", icon: <FiFileText /> },
  { label: "Recent Purchases", query: "Show my recent purchases", icon: <FiRefreshCw /> },
];

const STATUS_COLORS = {
  pending: "var(--warning)",
  processing: "var(--info)",
  confirmed: "var(--info)",
  shipped: "var(--accent-purple)",
  delivered: "var(--success)",
  cancelled: "var(--danger)",
};

const cssVar = (name, fallback) =>
  (typeof document !== "undefined" && getComputedStyle(document.documentElement).getPropertyValue(name).trim()) || fallback;

/* Scoped styles for the AI Assistant card only. */
const AI_CARD_CSS = `
.ai-card .card-body { display: flex; flex-direction: column; gap: 16px; }
.ai-card-top { display: flex; align-items: center; gap: 14px; flex-wrap: wrap; }
.ai-card-badge {
  width: 48px; height: 48px; flex: 0 0 48px; border-radius: 50%;
  background: var(--brand); color: #fff; font-size: 20px;
  display: flex; align-items: center; justify-content: center;
}
.ai-card-title-row { display: flex; align-items: center; gap: 10px; flex-wrap: wrap; }
.ai-card-title { font-size: 1.02rem; font-weight: 700; color: var(--text); }
.ai-card-status {
  display: inline-flex; align-items: center; gap: 5px;
  font-size: .7rem; font-weight: 600; color: var(--success);
  background: var(--success-bg); padding: 3px 9px; border-radius: var(--radius-pill, 999px);
}
.ai-card-dot { width: 6px; height: 6px; border-radius: 50%; background: var(--success); }
.ai-card-sub { font-size: .82rem; color: var(--text-muted); margin-top: 2px; }
.ai-card-open { display: inline-flex; align-items: center; gap: 6px; white-space: nowrap; }
.ai-card-prompts { border-top: 1px dashed var(--border); padding-top: 14px; }
.ai-card-prompts-label {
  display: block; font-size: .68rem; text-transform: uppercase;
  letter-spacing: .05em; color: var(--text-muted); margin-bottom: 9px; font-weight: 700;
}
.ai-card-prompt-row { display: flex; flex-wrap: wrap; gap: 8px; }
.ai-card-prompt {
  display: inline-flex; align-items: center; gap: 7px;
  padding: 7px 13px; border-radius: var(--radius-pill, 999px);
  border: 1px solid var(--border-strong); background: var(--surface);
  color: var(--text); font-size: .8rem; font-weight: 600; cursor: pointer;
  transition: border-color .15s ease, color .15s ease, background .15s ease;
}
.ai-card-prompt:hover { border-color: var(--brand); color: var(--brand); background: var(--brand-soft); }
@media (max-width: 768px) {
  .ai-card-top { gap: 10px; }
  .ai-card-badge { width: 40px; height: 40px; flex: 0 0 40px; font-size: 17px; }
  .ai-card-open { width: 100%; justify-content: center; }
  .ai-card-prompt { flex: 1 1 calc(50% - 8px); justify-content: center; padding: 8px 10px; font-size: .78rem; }
}
`;

export default function CustomerDashboard() {
  const navigate = useNavigate();
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [wallet, setWallet] = useState(null);
  const [loyaltyConfig, setLoyaltyConfig] = useState(null);

  useEffect(() => {
    api
      .get("/customer/dashboard")
      .then((res) => setData(res.data))
      .catch(() => setError("Failed to load dashboard"))
      .finally(() => setLoading(false));
    api.get("/loyalty/mine").then((res) => setWallet(res.data)).catch(() => {});
    api.get("/loyalty/config").then((res) => setLoyaltyConfig(res.data)).catch(() => {});
  }, []);

  if (loading) return <div className="py-5 text-center text-muted">Loading dashboard…</div>;
  if (error) return <div className="alert alert-danger">{error}</div>;

  const stats = [
    { label: "Total Orders", value: <AnimatedNumber value={data.totalOrders} />, icon: <FiPackage />, tint: "primary" },
    { label: "Pending", value: <AnimatedNumber value={data.pendingOrders} />, icon: <FiClock />, tint: "warning" },
    { label: "Processing", value: <AnimatedNumber value={data.processingOrders} />, icon: <FiSettings />, tint: "info" },
    { label: "Delivered", value: <AnimatedNumber value={data.deliveredOrders} />, icon: <FiCheckCircle />, tint: "success" },
    { label: "Total Spent", value: <AnimatedNumber value={data.totalSpent} prefix="₹" />, icon: <FiDollarSign />, tint: "danger" },
  ];

  const monthly = (data.monthlySeries || []).map((m) => ({ label: m.label, total: Number(m.total || 0) }));
  const statusDist = (data.statusDistribution || []).filter((s) => s.count > 0);
  const maxStatus = Math.max(1, ...statusDist.map((s) => Number(s.count)));

  return (
    <PageTransition>
      <div className="page-header">
        <div>
          <h2>My Dashboard</h2>
          <div className="page-title-sub">Welcome back! Here's an overview of your orders.</div>
        </div>
        <div className="d-flex gap-2 flex-wrap">
          <Link to="/shop" className="btn btn-primary">Browse Products</Link>
          <Link to="/my-orders" className="btn btn-outline-secondary">My Orders</Link>
        </div>
      </div>

      {/* STAT CARDS */}
      <div className="row g-3 mb-4">
        {stats.map((s) => (
          <div className="col-md-6 col-xl-3" key={s.label}>
            <StatCard label={s.label} value={s.value} icon={s.icon} tint={s.tint} />
          </div>
        ))}
      </div>

      {/* LOYALTY WALLET */}
      {wallet && (
        <div className="row g-3 mb-4">
          <div className="col-12">
            <div className="card h-100">
              <div className="card-body d-flex flex-wrap align-items-center gap-3">
                <div className="rounded-circle d-flex align-items-center justify-content-center text-white fw-bold" style={{ width: 56, height: 56, background: "var(--brand)", fontSize: 20 }}>
                  <FiAward />
                </div>
                <div className="flex-fill">
                  <div className="text-muted small">Loyalty Points</div>
                  <div className="fs-3 fw-bold">{wallet.points_balance}</div>
                  <div className="text-muted small">
                    {wallet.total_earned} earned · {wallet.total_redeemed} redeemed
                    {loyaltyConfig ? ` · 1 pt = ₹${loyaltyConfig.points_to_rupee} off your next order` : ""}
                  </div>
                </div>
                <Link to="/my-orders" className="btn btn-outline-primary">Redeem on next order</Link>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* AI ASSISTANT */}
      <div className="row g-3 mb-4">
        <div className="col-12">
          <div className="card h-100 ai-card">
            <div className="card-body">
              <style>{AI_CARD_CSS}</style>
              <div className="ai-card-top">
                <div className="ai-card-badge">
                  <FiMessageCircle />
                </div>
                <div className="flex-fill">
                  <div className="ai-card-title-row">
                    <span className="ai-card-title">AI Assistant</span>
                    <span className="ai-card-status">
                      <span className="ai-card-dot" /> Online
                    </span>
                  </div>
                  <div className="ai-card-sub">
                    Ask about your orders, payments, invoices and recent purchases.
                  </div>
                </div>
                <button
                  type="button"
                  className="btn btn-primary ai-card-open"
                  onClick={() => navigate("/customer-ai")}
                >
                  Open AI Assistant <FiArrowRight />
                </button>
              </div>

              <div className="ai-card-prompts">
                <span className="ai-card-prompts-label">Quick questions</span>
                <div className="ai-card-prompt-row">
                  {AI_QUICK_PROMPTS.map((p) => (
                    <button
                      key={p.label}
                      type="button"
                      className="ai-card-prompt"
                      onClick={() => navigate(`/customer-ai?q=${encodeURIComponent(p.query)}`)}
                    >
                      {p.icon}
                      <span>{p.label}</span>
                    </button>
                  ))}
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* CHARTS */}
      <div className="row g-3 mb-4">
        <div className="col-lg-7">
          <div className="card h-100">
            <div className="card-header d-flex align-items-center gap-2">
              <FiPieChart /> <span>Monthly Purchases</span>
            </div>
            <div className="card-body">
              {monthly.length === 0 ? (
                <EmptyState title="No purchase data yet" message="Your monthly spending will appear here as you shop." icon={<FiDollarSign />} />
              ) : (
                <ResponsiveContainer width="100%" height={240}>
                  <AreaChart data={monthly}>
                    <defs>
                      <linearGradient id="custGrad" x1="0" y1="0" x2="0" y2="1">
                        <stop offset="0%" stopColor={cssVar("--brand", "#3b82f6")} stopOpacity={0.35} />
                        <stop offset="100%" stopColor={cssVar("--brand", "#3b82f6")} stopOpacity={0.02} />
                      </linearGradient>
                    </defs>
                    <CartesianGrid stroke={cssVar("--chart-grid", "#e2e8f0")} vertical={false} />
                    <XAxis dataKey="label" stroke={cssVar("--text-muted", "#94a3b8")} tick={{ fill: cssVar("--text-secondary", "#64748b"), fontSize: 12 }} />
                    <YAxis stroke={cssVar("--text-muted", "#94a3b8")} tick={{ fill: cssVar("--text-secondary", "#64748b"), fontSize: 12 }} />
                    <Tooltip
                      formatter={(v) => [formatINR(v), "Spent"]}
                      contentStyle={{ background: "var(--surface)", border: "1px solid var(--border)", borderRadius: 8, color: "var(--text)" }}
                      labelStyle={{ color: "var(--text)" }}
                    />
                    <Area type="monotone" dataKey="total" stroke={cssVar("--brand", "#3b82f6")} strokeWidth={2.5} fill="url(#custGrad)" />
                  </AreaChart>
                </ResponsiveContainer>
              )}
            </div>
          </div>
        </div>

        <div className="col-lg-5">
          <div className="card h-100">
            <div className="card-header">Order Status Distribution</div>
            <div className="card-body">
              {statusDist.length === 0 ? (
                <EmptyState title="No orders yet" message="Your order status breakdown will show here." icon={<FiPackage />} />
              ) : (
                <div className="d-flex flex-column gap-3">
                  {statusDist.map((s) => {
                    const pct = Math.round((Number(s.count) / maxStatus) * 100);
                    return (
                      <div key={s.status}>
                        <div className="d-flex justify-content-between small mb-1">
                          <span className="text-capitalize">{s.status}</span>
                          <span className="fw-semibold">{s.count}</span>
                        </div>
                        <div className="dash-status-bar">
                          <div
                            className="dash-status-fill"
                            style={{ width: `${Math.max(pct, 6)}%`, background: STATUS_COLORS[s.status] || "var(--brand)" }}
                          />
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          </div>
        </div>
      </div>

      {/* RECENT ORDERS */}
      <div className="card mb-4">
        <div className="card-header d-flex justify-content-between align-items-center">
          <span>Recent Orders</span>
          <Link to="/my-orders" className="btn btn-sm btn-outline-secondary">View All <FiArrowRight /></Link>
        </div>
        <div className="card-body p-0">
          <div className="table-responsive">
            <table className="table table-hover align-middle mb-0">
              <thead>
                <tr>
                  <th>Order ID</th>
                  <th>Invoice</th>
                  <th>Date</th>
                  <th>Total</th>
                  <th>Payment</th>
                  <th>Status</th>
                  <th></th>
                </tr>
              </thead>
              <tbody>
                {data.recentOrders.length === 0 ? (
                  <tr>
                    <td colSpan={7} className="text-center py-4 text-muted">
                      No orders yet. <Link to="/shop">Start shopping!</Link>
                    </td>
                  </tr>
                ) : (
                  data.recentOrders.map((o) => (
                    <tr key={o.id}>
                      <td>#{o.id}</td>
                      <td>{o.invoice_no || "—"}</td>
                      <td>{formatDate(o.created_at)}</td>
                      <td>{formatINR(Number(o.total_amount) - Number(o.discount))}</td>
                      <td>
                        <span className={`badge ${isPaid(o.payment_status) ? "bg-success" : "bg-warning"}`}>
                          {o.payment_status}
                        </span>
                      </td>
                      <td><StatusBadge status={o.status} /></td>
                      <td>
                        <Link to={`/my-orders/${o.id}`} className="btn btn-sm btn-light">View</Link>
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </div>
      </div>

      {/* RECENT NOTIFICATIONS */}
      <div className="card">
        <div className="card-header d-flex justify-content-between align-items-center">
          <span className="d-flex align-items-center gap-2"><FiBell /> Recent Notifications</span>
          <Link to="/notifications" className="btn btn-sm btn-outline-secondary">View All</Link>
        </div>
        <div className="card-body">
          {(data.recentNotifications || []).length === 0 ? (
            <EmptyState title="You're all caught up!" message="Notifications about your orders and payments will appear here." icon={<FiBell />} />
          ) : (
            <ul className="list-unstyled mb-0">
              {data.recentNotifications.map((n) => (
                <li key={n.id} className={`d-flex justify-content-between align-items-start gap-2 py-2 border-bottom border-light-subtle ${!n.is_read ? "fw-semibold" : ""}`}>
                  <div>
                    <div>{n.title}</div>
                    <div className="small text-muted">{n.message}</div>
                  </div>
                  <span className="small text-muted text-nowrap">{timeAgo(n.created_at)}</span>
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>
    </PageTransition>
  );
}