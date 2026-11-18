import React, { useEffect, useState } from "react";
import api from "../lib/api";
import { Link } from "react-router-dom";
import {
  Chart as ChartJS,
  CategoryScale,
  LinearScale,
  BarElement,
  ArcElement,
  LineElement,
  PointElement,
  Tooltip,
  Legend,
} from "chart.js";
import { Bar, Pie, Line } from "react-chartjs-2";
import { FiBox, FiShoppingCart, FiUsers, FiDollarSign, FiArrowRight, FiClock, FiStar, FiUser } from "react-icons/fi";
import useTheme from "../lib/theme";
import { StatCard, Skeleton, EmptyState, StatusBadge, useToast, AnimatedNumber, Sparkline, PageTransition } from "./ui";
import { formatINR } from "../lib/utils";

ChartJS.register(
  CategoryScale,
  LinearScale,
  BarElement,
  ArcElement,
  LineElement,
  PointElement,
  Tooltip,
  Legend
);

const STATUS_COLORS = {
  pending: "#d97706",
  processing: "#0284c7",
  confirmed: "#0665c4",
  shipped: "#155ecc",
  delivered: "#16a34a",
  cancelled: "#dc2626",
};

function greeting() {
  const h = new Date().getHours();
  if (h < 12) return "Good morning";
  if (h < 17) return "Good afternoon";
  return "Good evening";
}

export default function AdminDashboard() {
  const [data, setData] = useState(null);
  const [threshold, setThreshold] = useState(5);
  const [thresholdMsg, setThresholdMsg] = useState("");
  const { theme } = useTheme();
  const toast = useToast();

  const gridColor = getComputedStyle(document.documentElement).getPropertyValue("--chart-grid").trim() || "#eef1f6";
  const textColor = theme === "dark" ? "#aab4c5" : "#5b6472";

  useEffect(() => {
    api.get("/dashboard/full")
      .then((res) => setData(res.data))
      .catch((err) => console.error(err));

    api.get("/settings/low-stock")
      .then((res) => setThreshold(res.data.threshold))
      .catch(() => {});
  }, []);

  const saveThreshold = async () => {
    try {
      const res = await api.put("/settings/low-stock", { threshold });
      setThreshold(res.data.threshold);
      setThresholdMsg("Threshold updated");

      const d = await api.get("/dashboard/full");
      setData(d.data);

      setTimeout(() => setThresholdMsg(""), 3000);
    } catch (err) {
      toast.error(err.response?.data?.error || "Failed to update threshold");
    }
  };

  if (!data) {
    return (
      <>
        <Skeleton type="card" rows={4} />
        <Skeleton type="chart" />
      </>
    );
  }

  const sales = data.salesChart || [];
  const status = data.orderStatusStats || [];
  const lowStock = data.lowStock || [];
  const recentOrders = data.recentOrders || [];
  const ordersTrend = data.ordersTrend || [];
  const topProducts = data.topProducts || [];
  const recentCustomers = data.recentCustomers || [];
  const stats = data.stats || {};
  const pendingOrders = stats.pendingOrders || 0;

  const countByStatus = (s) => Number(status.find((x) => x.status === s)?.count || 0);

  const salesChart = {
    labels: sales.map((d) => d.date),
    datasets: [
      {
        label: "Revenue",
        data: sales.map((d) => d.amount),
        backgroundColor: "rgba(37, 99, 235, .85)",
        hoverBackgroundColor: "rgba(29, 78, 216, .95)",
        borderRadius: 8,
        maxBarThickness: 42,
      },
    ],
  };

  const trendChart = {
    labels: ordersTrend.map((d) => d.date),
    datasets: [
      {
        label: "Orders",
        data: ordersTrend.map((d) => d.orders),
        borderColor: "#16a34a",
        backgroundColor: "rgba(22, 163, 74, .12)",
        fill: true,
        tension: 0.4,
        pointRadius: 3,
        pointBackgroundColor: "#16a34a",
      },
    ],
  };

  const statusChart = {
    labels: status.map((s) => s.status),
    datasets: [
      {
        data: status.map((s) => s.count),
        backgroundColor: status.map((s) => STATUS_COLORS[s.status] || "#94a3b8"),
        borderWidth: 2,
        borderColor: getComputedStyle(document.documentElement).getPropertyValue("--surface").trim() || "#fff",
      },
    ],
  };

  const chartOptions = {
    responsive: true,
    maintainAspectRatio: false,
    plugins: {
      legend: { labels: { color: textColor, font: { size: 12 } } },
    },
    scales: {
      x: { grid: { color: gridColor }, ticks: { color: textColor } },
      y: { grid: { color: gridColor }, ticks: { color: textColor } },
    },
  };

  const pieOptions = {
    responsive: true,
    maintainAspectRatio: false,
    plugins: { legend: { position: "bottom", labels: { color: textColor, padding: 14, font: { size: 12 } } } },
  };

  return (
    <PageTransition>
      {/* GREETING */}
      <div className="dash-greet mb-4">
        <div>
          <h2 className="dash-greet-title">
            {greeting()}, Admin <span className="dash-wave">👋</span>
          </h2>
          <div className="dash-greet-sub">Here's what's happening in your distribution network.</div>
        </div>
        <Link to="/admin/analytics" className="btn btn-outline-secondary">
          Open Analytics <FiArrowRight />
        </Link>
      </div>

      {/* KPI STATS */}
      <div className="row g-3 mb-4">
        <div className="col-lg-3 col-md-6 col-6">
          <StatCard
            label="Products" value={<AnimatedNumber value={stats.products ?? 0} />} icon={<FiBox />} tint="info"
            footer={<Sparkline data={sales.slice(-7).map((s) => s.amount)} color="#0284c7" />}
          />
        </div>
        <div className="col-lg-3 col-md-6 col-6">
          <StatCard
            label="Orders" value={<AnimatedNumber value={stats.orders ?? 0} />} icon={<FiShoppingCart />} tint="primary"
            footer={<Sparkline data={status.map((s) => s.count)} color="#2563eb" />}
          />
        </div>
        <div className="col-lg-3 col-md-6 col-6">
          <StatCard
            label="Customers" value={<AnimatedNumber value={stats.customers ?? 0} />} icon={<FiUsers />} tint="success"
            footer={<Sparkline data={sales.slice(-7).map((s, i) => s.amount / (i + 2))} color="#16a34a" />}
          />
        </div>
        <div className="col-lg-3 col-md-6 col-6">
          <StatCard
            label="Revenue" value={<AnimatedNumber value={stats.revenue ?? 0} prefix="₹" />} icon={<FiDollarSign />} tint="warning"
            footer={<Sparkline data={sales.slice(-7).map((s) => s.amount)} color="#d97706" />}
          />
        </div>
      </div>

      {/* PENDING ORDERS STRIP */}
      {pendingOrders > 0 && (
        <div className="alert alert-warning d-flex align-items-center gap-2 mb-4 flex-wrap">
          <FiClock />
          <span>
            <strong>{pendingOrders}</strong> order{pendingOrders !== 1 ? "s" : ""} awaiting action
            <span className="ms-2 text-muted small">
              ({countByStatus("pending")} pending · {countByStatus("processing")} processing · {countByStatus("confirmed")} confirmed)
            </span>
          </span>
          <Link to="/admin/order-tracking?status=pending" className="ms-auto btn btn-sm btn-outline-warning">Review Orders</Link>
        </div>
      )}

      {/* ALERT BANNER */}
      {lowStock.length > 0 && (
        <div className="alert alert-danger d-flex align-items-center gap-2 mb-4">
          <span>⚠</span>
          <span>
            <strong>{data.lowStockCount || lowStock.length}</strong> product
            {data.lowStockCount !== 1 ? "s" : ""} at or below the low-stock threshold (
            {data.lowStockThreshold} units)
          </span>
          <Link to="/admin/low-stock" className="ms-auto btn btn-sm btn-outline-danger">Review</Link>
        </div>
      )}

      {/* CHARTS ROW 1 */}
      <div className="row g-3 mb-4">
        <div className="col-lg-8">
          <div className="card h-100">
            <div className="card-header">Revenue</div>
            <div className="card-body" style={{ height: 280 }}>
              <Bar data={salesChart} options={chartOptions} />
            </div>
          </div>
        </div>
        <div className="col-lg-4">
          <div className="card h-100">
            <div className="card-header">Order Status</div>
            <div className="card-body" style={{ height: 280 }}>
              <Pie data={statusChart} options={pieOptions} />
            </div>
          </div>
        </div>
      </div>

      {/* CHARTS ROW 2 */}
      <div className="row g-3 mb-4">
        <div className="col-lg-8">
          <div className="card h-100">
            <div className="card-header">Orders Trend (Last 7 Days)</div>
            <div className="card-body" style={{ height: 280 }}>
              {ordersTrend.length === 0 ? (
                <EmptyState title="No order data yet" sub="New order activity will be plotted here." />
              ) : (
                <Line data={trendChart} options={chartOptions} />
              )}
            </div>
          </div>
        </div>
        <div className="col-lg-4">
          <div className="card h-100">
            <div className="card-header d-flex align-items-center gap-2">
              <FiUser /> Recent Customers
            </div>
            <div className="card-body">
              {recentCustomers.length === 0 ? (
                <EmptyState title="No customers yet" sub="New signups will appear here." />
              ) : (
                <div>
                  {recentCustomers.map((c) => (
                    <div key={c.id} className="d-flex justify-content-between align-items-center py-2 border-bottom border-light-subtle">
                      <div className="text-truncate me-2">
                        <div className="fw-semibold text-truncate">{c.name}</div>
                        <div className="small text-muted">{c.orders_count} order{c.orders_count !== 1 ? "s" : ""}</div>
                      </div>
                      <span className="small fw-semibold text-success">{formatINR(c.total_spent)}</span>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        </div>
      </div>

      {/* LOWER */}
      <div className="row g-3 mb-4">
        {/* LOW STOCK */}
        <div className="col-lg-4">
          <div className="card h-100">
            <div className="card-header">Low Stock</div>
            <div className="card-body">
              {/* THRESHOLD CONTROL */}
              <div className="d-flex gap-2 align-items-center mb-3">
                <input
                  className="form-control"
                  style={{ width: 90 }}
                  type="number"
                  min="0"
                  value={threshold}
                  onChange={(e) => setThreshold(e.target.value)}
                  aria-label="Low stock threshold"
                />
                <button className="btn btn-primary btn-sm" onClick={saveThreshold}>
                  Save
                </button>
                {thresholdMsg && <span className="text-success small">{thresholdMsg}</span>}
              </div>

              {lowStock.length === 0 ? (
                <EmptyState icon="✅" title="All products available" sub="No products are at or below the threshold." />
              ) : (
                <div>
                  {lowStock.map((p) => (
                    <div key={p.id} className="d-flex justify-content-between align-items-center py-2 border-bottom">
                      <div className="text-truncate me-2">{p.name}</div>
                      <span className={`status-badge ${p.stock <= 0 ? "status-out-of-stock" : "status-low-stock"}`}>{p.stock} left</span>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        </div>

        {/* TOP PRODUCTS */}
        <div className="col-lg-4">
          <div className="card h-100">
            <div className="card-header d-flex align-items-center gap-2">
              <FiStar /> Top Products
            </div>
            <div className="card-body">
              {topProducts.length === 0 ? (
                <EmptyState title="No sales yet" sub="Best sellers will appear here." />
              ) : (
                <div>
                  {topProducts.map((p, i) => (
                    <div key={p.id} className="d-flex justify-content-between align-items-center py-2 border-bottom border-light-subtle">
                      <div className="text-truncate me-2">
                        <span className="me-2 text-muted">{i + 1}.</span>
                        <span className="text-truncate">{p.name}</span>
                      </div>
                      <span className="small fw-semibold text-nowrap">{p.qty_sold} sold · {formatINR(p.revenue)}</span>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        </div>

        {/* RECENT ORDERS */}
        <div className="col-lg-4">
          <div className="card h-100">
            <div className="card-header d-flex justify-content-between align-items-center">
              <span>Recent Orders</span>
              <Link to="/admin/orders" className="btn btn-sm btn-outline-secondary">View All <FiArrowRight /></Link>
            </div>
            <div className="card-body p-0">
              {recentOrders.length === 0 ? (
                <EmptyState title="No orders yet" sub="Customer orders will appear here once placed." />
              ) : (
                <div>
                  {recentOrders.map((o) => (
                    <div key={o.id} className="d-flex justify-content-between align-items-center px-3 py-2 border-bottom">
                      <div>
                        <div className="fw-semibold">#{o.id}</div>
                        <div className="small text-muted text-truncate">{o.customer}</div>
                      </div>
                      <div className="text-end">
                        <div className="small fw-semibold">₹{o.total}</div>
                        <StatusBadge status={o.status} />
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        </div>
      </div>
    </PageTransition>
  );
}