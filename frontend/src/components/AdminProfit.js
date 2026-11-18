import React, { useEffect, useState, useCallback } from "react";
import api from "../lib/api";
import { formatINR } from "../lib/utils";
import { Skeleton, EmptyState } from "./ui";
import {
  LineChart,
  Line,
  XAxis,
  YAxis,
  Tooltip,
  ResponsiveContainer,
  CartesianGrid,
} from "recharts";
import { FiTrendingUp, FiDollarSign, FiPercent, FiAlertCircle, FiRefreshCw } from "react-icons/fi";

const cssVar = (name, fallback) =>
  (typeof document !== "undefined" && getComputedStyle(document.documentElement).getPropertyValue(name).trim()) || fallback;

const SUMMARY_CARDS = [
  { key: "revenue", label: "Total Revenue", icon: FiDollarSign, tone: "text-primary" },
  { key: "cost", label: "Cost of Goods", icon: FiPercent, tone: "text-danger" },
  { key: "profit", label: "Gross Profit", icon: FiTrendingUp, tone: "text-success" },
  { key: "margin", label: "Margin", icon: FiPercent, tone: "text-warning", percent: true },
];

export default function AdminProfit() {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");

  const notify = (msg) => {
    setSuccess(msg);
    window.setTimeout(() => setSuccess(""), 3500);
  };

  const fetchData = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const res = await api.get("/profit/summary");
      setData(res.data);
      notify("Profit summary refreshed");
    } catch (err) {
      setError(err.response?.data?.error || "Failed to load profit summary");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  const summary = data?.summary || {};
  const products = data?.products || [];
  const monthlyTrend = data?.monthlyTrend || [];

  if (loading) {
    return (
      <>
        <Skeleton type="card" rows={6} />
        <div className="mt-3">
          <Skeleton type="chart" />
        </div>
      </>
    );
  }

  return (
    <div className="container-fluid py-4">
      {/* HEADER */}
      <div className="d-flex justify-content-between align-items-center mb-4">
        <div>
          <h2 className="mb-1">Profit & Margin</h2>
          <div className="text-muted">Revenue, cost and margin across delivered orders.</div>
        </div>
        <button className="btn btn-outline-secondary" onClick={fetchData} title="Refresh profit summary">
          <FiRefreshCw /> Refresh
        </button>
      </div>

      {/* ERRORS */}
      {error && (
        <div className="alert alert-danger d-flex justify-content-between align-items-center">
          <div>
            <FiAlertCircle className="me-2" />
            {error}
          </div>
          <button className="btn btn-sm btn-outline-danger" onClick={fetchData}>
            Retry
          </button>
        </div>
      )}

      {/* SUCCESS */}
      {success && (
        <div className="alert alert-success d-flex justify-content-between align-items-center">
          <span>{success}</span>
          <button type="button" className="btn-close" aria-label="Dismiss" onClick={() => setSuccess("")} />
        </div>
      )}

      {/* SUMMARY CARDS */}
      <div className="row g-3 mb-4">
        {SUMMARY_CARDS.map(({ key, label, icon: Icon, tone, percent }) => {
          const raw = summary[key] ?? 0;
          const value = percent ? `${Number(raw).toFixed(2)}%` : formatINR(raw);
          return (
            <div className="col-6 col-md-6 col-xl-3" key={key}>
              <div className="card p-3 h-100">
                <div className="d-flex justify-content-between align-items-center">
                  <div>
                    <div className="text-muted small">{label}</div>
                    <div className={`fs-4 fw-bold ${tone}`}>{value}</div>
                  </div>
                  <Icon className={`fs-3 ${tone}`} />
                </div>
              </div>
            </div>
          );
        })}
      </div>

      {/* MONTHLY TREND */}
      <div className="card mb-4">
        <div className="card-header d-flex align-items-center gap-2">
          <FiTrendingUp /> Monthly Profit Trend
        </div>
        <div className="card-body" style={{ height: 300 }}>
          {monthlyTrend.length === 0 ? (
            <EmptyState
              title="No trend data yet"
              sub="Monthly revenue and profit will appear here once orders are delivered."
            />
          ) : (
            <ResponsiveContainer width="100%" height="100%">
              <LineChart data={monthlyTrend}>
                <CartesianGrid stroke={cssVar("--chart-grid", "#e2e8f0")} />
                <XAxis
                  dataKey="month"
                  stroke={cssVar("--text-muted", "#94a3b8")}
                  tick={{ fill: cssVar("--text-secondary", "#64748b") }}
                />
                <YAxis
                  stroke={cssVar("--text-muted", "#94a3b8")}
                  tick={{ fill: cssVar("--text-secondary", "#64748b") }}
                />
                <Tooltip
                  contentStyle={{
                    background: "var(--surface)",
                    border: "1px solid var(--border)",
                    borderRadius: 8,
                    color: "var(--text)",
                  }}
                  labelStyle={{ color: "var(--text)" }}
                />
                <Line type="monotone" dataKey="revenue" name="Revenue" stroke={cssVar("--brand", "#3b82f6")} strokeWidth={2.5} dot={{ r: 3 }} />
                <Line type="monotone" dataKey="cost" name="Cost" stroke="#d97706" strokeWidth={2} dot={{ r: 3 }} />
                <Line type="monotone" dataKey="profit" name="Profit" stroke="#16a34a" strokeWidth={2.5} dot={{ r: 3 }} />
              </LineChart>
            </ResponsiveContainer>
          )}
        </div>
      </div>

      {/* PRODUCT-LEVEL PROFIT */}
      <div className="card">
        <div className="card-header d-flex justify-content-between align-items-center">
          <span>Product-Level Profit</span>
          <span className="badge bg-primary">{products.length} products</span>
        </div>
        <div className="card-body p-0">
          {products.length === 0 ? (
            <EmptyState
              title="No product profit data"
              sub="Product-level profit appears once delivered orders exist."
            />
          ) : (
            <div className="table-responsive">
              <table className="table table-hover align-middle mb-0">
                <thead>
                  <tr>
                    <th>Product</th>
                    <th className="text-end">Purchase Price</th>
                    <th className="text-end">Avg Selling Price</th>
                    <th className="text-end">Qty Sold</th>
                    <th className="text-end">Revenue</th>
                    <th className="text-end">Cost</th>
                    <th className="text-end">Profit</th>
                    <th className="text-end">Margin</th>
                  </tr>
                </thead>
                <tbody>
                  {products.map((p, i) => (
                    <tr key={i}>
                      <td className="fw-semibold">{p.product_name}</td>
                      <td className="text-end">{formatINR(p.purchase_price)}</td>
                      <td className="text-end">{formatINR(p.avg_selling_price)}</td>
                      <td className="text-end">{p.qty_sold}</td>
                      <td className="text-end">{formatINR(p.revenue)}</td>
                      <td className="text-end">{formatINR(p.cost)}</td>
                      <td className={`text-end fw-semibold ${Number(p.profit) >= 0 ? "text-success" : "text-danger"}`}>
                        {formatINR(p.profit)}
                      </td>
                      <td className="text-end">{Number(p.margin_pct).toFixed(2)}%</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}