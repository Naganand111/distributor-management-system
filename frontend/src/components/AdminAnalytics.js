import React, { useCallback, useEffect, useState } from "react";
import { Line, Doughnut, Bar } from "react-chartjs-2";
import {
  Chart as ChartJS,
  CategoryScale,
  LinearScale,
  PointElement,
  LineElement,
  BarElement,
  ArcElement,
  Title,
  Tooltip,
  Legend,
  Filler,
} from "chart.js";
import api from "../lib/api";
import { formatINR } from "../lib/utils";

const cssVar = (name, fallback) =>
  (typeof document !== "undefined" && getComputedStyle(document.documentElement).getPropertyValue(name).trim()) || fallback;

ChartJS.register(
  CategoryScale, LinearScale, PointElement, LineElement, BarElement, ArcElement,
  Title, Tooltip, Legend, Filler,
);

export default function AdminAnalytics() {
  const [days, setDays] = useState(30);
  const [ov, setOv] = useState(null);
  const [trend, setTrend] = useState([]);
  const [perf, setPerf] = useState(null);
  const [inv, setInv] = useState(null);
  const [quality, setQuality] = useState(null);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const from = new Date(Date.now() - Number(days) * 86400000).toISOString().slice(0, 10);
      const to = new Date().toISOString().slice(0, 10);
      const q = `?from=${from}&to=${to}`;
      const [o, t, p, i, ql] = await Promise.all([
        api.get(`/analytics/overview${q}`),
        api.get(`/analytics/trend${q}`),
        api.get("/analytics/performance"),
        api.get("/analytics/inventory"),
        api.get("/analytics/quality"),
      ]);
      setOv(o.data);
      setTrend(Array.isArray(t.data) ? t.data : []);
      setPerf(p.data);
      setInv(i.data);
      setQuality(ql.data);
    } catch (err) {
      console.error("Load analytics:", err);
    } finally {
      setLoading(false);
    }
  }, [days]);

  useEffect(() => { load(); }, [load]);

  const lineData = {
    labels: trend.map((d) => d.day?.slice(5)),
    datasets: [
      { label: "Revenue", data: trend.map((d) => Number(d.revenue)), borderColor: cssVar("--brand", "#3b82f6"), backgroundColor: cssVar("--brand-soft", "rgba(59,130,246,0.1)"), fill: true, tension: 0.4 },
      { label: "Orders", data: trend.map((d) => Number(d.orders)), borderColor: cssVar("--success", "#10b981"), backgroundColor: "transparent", yAxisID: "y1" },
    ],
  };

  const lineOpts = {
    responsive: true,
    plugins: {
      legend: { position: "bottom", labels: { color: cssVar("--text-secondary", "#64748b") } },
      tooltip: { bodyColor: cssVar("--text", "#0f172a") },
    },
    scales: {
      x: { ticks: { color: cssVar("--text-muted", "#94a3b8") }, grid: { color: cssVar("--chart-grid", "#eef1f6") } },
      y: { beginAtZero: true, ticks: { color: cssVar("--text-muted", "#94a3b8") }, grid: { color: cssVar("--chart-grid", "#eef1f6") } },
      y1: { position: "right", beginAtZero: true, grid: { display: false }, ticks: { color: cssVar("--text-muted", "#94a3b8") } },
    },
  };

  const statusData = {
    labels: (ov?.orderStatus || []).map((s) => s.status),
    datasets: [{ data: (ov?.orderStatus || []).map((s) => Number(s.cnt)), backgroundColor: [cssVar("--brand", "#3b82f6"), cssVar("--success", "#10b981"), cssVar("--warning", "#f59e0b"), cssVar("--danger", "#ef4444"), cssVar("--purple", "#8b5cf6"), "#8e8e93"] }],
  };

  const statusOpts = {
    responsive: true,
    plugins: { legend: { position: "bottom", labels: { color: cssVar("--text-secondary", "#64748b") } } },
  };

  const kpi = (label, value, sub) => (
    <div className="col-md-3 mb-3">
      <div className="card shadow-sm h-100">
        <div className="card-body">
          <div className="text-muted small text-uppercase">{label}</div>
          <div className="fs-4 fw-bold mt-1">{value}</div>
          {sub && <div className="text-muted small mt-1">{sub}</div>}
        </div>
      </div>
    </div>
  );

  if (loading) return <div className="loading" style={{ padding: 40 }}>Loading analytics…</div>;

  return (
    <div className="container-fluid">
      <div className="d-flex justify-content-between align-items-center mb-3">
        <h2 className="mb-0">Analytics &amp; BI</h2>
        <select className="form-select form-select-sm" style={{ width: 160 }} value={days}
          onChange={(e) => setDays(e.target.value)}>
          <option value="7">Last 7 days</option>
          <option value="30">Last 30 days</option>
          <option value="90">Last 90 days</option>
        </select>
      </div>

      <div className="row">
        {kpi("Total Orders", ov?.summary.totalOrders ?? 0)}
        {kpi("Gross Revenue", formatINR(ov?.summary.grossRevenue), `${formatINR(ov?.summary.totalGst)} GST`)}
        {kpi("Collected", formatINR(ov?.summary.totalReceived), `${ov?.summary.totalPayments ?? 0} payments`)}
        {kpi("New Retailers", ov?.summary.newRetailers ?? 0)}
      </div>

      <div className="row">
        <div className="col-md-8 mb-3">
          <div className="card shadow-sm h-100">
            <div className="card-header bg-white fw-semibold">Sales Trend</div>
            <div className="card-body"><Line data={lineData} options={lineOpts} /></div>
          </div>
        </div>
        <div className="col-md-4 mb-3">
          <div className="card shadow-sm h-100">
            <div className="card-header bg-white fw-semibold">Order Status</div>
            <div className="card-body"><Doughnut data={statusData} options={statusOpts} /></div>
          </div>
        </div>
      </div>

      <div className="row">
        <div className="col-md-6 mb-3">
          <div className="card shadow-sm h-100">
            <div className="card-header bg-white fw-semibold">Top Products</div>
            <div className="table-responsive">
              <table className="table table-sm mb-0">
                <thead><tr><th>Product</th><th>Units</th><th>Revenue</th></tr></thead>
                <tbody>
                  {(ov?.topProducts || []).map((p) => (
                    <tr key={p.product_id}>
                      <td>{p.product_name}</td><td>{p.units_sold}</td><td>{formatINR(p.revenue)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </div>
        <div className="col-md-6 mb-3">
          <div className="card shadow-sm h-100">
            <div className="card-header bg-white fw-semibold">Top Retailers</div>
            <div className="table-responsive">
              <table className="table table-sm mb-0">
                <thead><tr><th>Retailer</th><th>Orders</th><th>Revenue</th></tr></thead>
                <tbody>
                  {(ov?.topRetailers || []).map((r, i) => (
                    <tr key={i}>
                      <td>{r.retailer_name || "—"}</td><td>{r.orders}</td><td>{formatINR(r.revenue)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      </div>

      <div className="row">
        <div className="col-md-7 mb-3">
          <div className="card shadow-sm h-100">
            <div className="card-header bg-white fw-semibold">Inventory Metrics</div>
            <div className="card-body">
              <div className="row text-center">
                <div className="col"><div className="fs-4 fw-bold">{inv?.inventory.totalProducts ?? 0}</div><div className="text-muted small">Products</div></div>
                <div className="col"><div className="fs-4 fw-bold">{inv?.inventory.totalUnits ?? 0}</div><div className="text-muted small">Units</div></div>
                <div className="col"><div className="fs-4 fw-bold">{formatINR(inv?.inventory.stockValue)}</div><div className="text-muted small">Stock Value</div></div>
                <div className="col"><div className="fs-4 fw-bold text-danger">{inv?.inventory.lowStock ?? 0}</div><div className="text-muted small">Low Stock</div></div>
                <div className="col"><div className="fs-4 fw-bold text-warning">{inv?.inventory.expiringSoon ?? 0}</div><div className="text-muted small">Expiring 30d</div></div>
              </div>
              <hr />
              <div className="text-muted small mb-2">Quality Summary:</div>
              <div className="d-flex gap-4 small">
                <span>Returns: <strong>{quality?.returns?.length ?? 0}</strong></span>
                <span>Damaged: <strong>{quality?.damaged ?? 0} ({quality?.damagedUnits ?? 0}u)</strong></span>
                <span>Expired: <strong>{quality?.expired ?? 0} ({quality?.expiredUnits ?? 0}u)</strong></span>
              </div>
            </div>
          </div>
        </div>
        <div className="col-md-5 mb-3">
          <div className="card shadow-sm h-100">
            <div className="card-header bg-white fw-semibold">Sales Reps / Territories</div>
            <div className="card-body">
              <div className="text-muted small mb-1">Representatives: <strong>{perf?.representatives?.length ?? 0}</strong></div>
              <Bar
                data={{
                  labels: (perf?.representatives || []).map((r) => r.name),
                  datasets: [{ label: "Revenue", data: (perf?.representatives || []).map((r) => Number(r.revenue)), backgroundColor: cssVar("--brand", "#3b82f6") }],
                }}
                options={{
                  responsive: true,
                  plugins: { legend: { display: false, labels: { color: cssVar("--text-secondary", "#64748b") } } },
                  scales: {
                    x: { ticks: { color: cssVar("--text-muted", "#94a3b8") }, grid: { color: cssVar("--chart-grid", "#eef1f6") } },
                    y: { beginAtZero: true, ticks: { color: cssVar("--text-muted", "#94a3b8") }, grid: { color: cssVar("--chart-grid", "#eef1f6") } },
                  },
                }}
              />
              <div className="mt-3 text-muted small mb-1">Territories: <strong>{perf?.territories?.length ?? 0}</strong></div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
