import React, { useEffect, useState, useCallback } from "react";
import api from "../lib/api";
import { API_BASE_URL } from "../lib/config";
import { formatINR, formatDate } from "../lib/utils";
import Skeleton from "./ui/Skeleton";
import EmptyState from "./ui/EmptyState";
import { FiDownload, FiPlus, FiFilter } from "react-icons/fi";
import {
  LineChart,
  Line,
  XAxis,
  YAxis,
  Tooltip,
  CartesianGrid,
  ResponsiveContainer,
} from "recharts";

const cssVar = (name, fallback) =>
  (typeof document !== "undefined" && getComputedStyle(document.documentElement).getPropertyValue(name).trim()) || fallback;

async function downloadReport(path, filename) {
  const token = localStorage.getItem("token");

  const res = await fetch(`${API_BASE_URL}${path}`, {
    headers: token ? { Authorization: `Bearer ${token}` } : {},
  });

  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.message || "Download failed");
  }

  const blob = await res.blob();
  const url = window.URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  link.remove();
  window.URL.revokeObjectURL(url);
}

const REPORT_GROUPS = [
  {
    label: "Sales",
    reports: [
      { key: "sales/daily", title: "Daily Sales", exportType: "sales", columns: ["date", "revenue", "orders", "items_sold", "avg_order_value"] },
      { key: "sales/weekly", title: "Weekly Sales", exportType: "sales", columns: ["week_start", "revenue", "orders", "items_sold"] },
      { key: "sales/monthly", title: "Monthly Sales", exportType: "sales", columns: ["month", "revenue", "orders", "items_sold"] },
      { key: "sales/by-product", title: "Sales by Product", exportType: "products", columns: ["product_name", "sku", "total_sold", "total_revenue"] },
      { key: "sales/by-customer", title: "Sales by Customer", exportType: "customers", columns: ["customer_name", "order_count", "total_revenue"] },
      { key: "sales/by-sales-rep", title: "Sales by Rep", exportType: "sales", columns: ["sales_rep_name", "order_count", "total_revenue"] },
      { key: "sales/by-territory", title: "Sales by Territory", exportType: "sales", columns: ["territory_name", "order_count", "total_revenue"] },
      { key: "sales/status-report", title: "Order Status Report", exportType: "sales", columns: ["status", "count", "total_value"] },
    ],
  },
  {
    label: "Inventory",
    reports: [
      { key: "inventory/current", title: "Current Stock", exportType: "inventory", columns: ["name", "sku", "stock", "purchase_price", "stock_value", "effective_reorder_level", "is_low_stock"] },
      { key: "inventory/movement", title: "Stock Movements", exportType: "inventory", columns: ["product_name", "type", "quantity", "reference", "created_at"] },
      { key: "inventory/dead-stock", title: "Dead Stock (90 days)", exportType: "inventory", columns: ["name", "sku", "stock", "purchase_price", "stock_value"] },
      { key: "inventory/valuation", title: "Inventory Valuation", exportType: "inventory", columns: [] },
    ],
  },
  {
    label: "Purchases",
    reports: [
      { key: "purchases/summary", title: "Purchase Summary", exportType: "purchases", columns: [] },
      { key: "purchases/by-supplier", title: "Purchases by Supplier", exportType: "purchases", columns: ["supplier_name", "po_count", "total_value"] },
    ],
  },
  {
    label: "Financial",
    reports: [
      { key: "financial/summary", title: "P&L Summary", exportType: null, columns: [] },
      { key: "financial/expenses", title: "Expenses", exportType: null, columns: [] },
    ],
  },
];

const EXPENSE_CATEGORIES = ["Rent", "Utilities", "Salaries", "Marketing", "Transport", "Office Supplies", "Misc"];

const FORMAT_KEYS = ["revenue", "total_revenue", "total_value", "stock_value", "purchase_price", "avg_order_value", "total_amount", "outstanding", "payments_collected", "purchase_cost", "gross_profit"];

function formatCell(key, value) {
  if (value == null || value === "") return "—";
  if (FORMAT_KEYS.some((k) => key.toLowerCase().includes(k) || k === key)) return formatINR(value);
  if (key.toLowerCase().includes("date") || key.toLowerCase().includes("created_at")) return formatDate(value);
  if (key === "is_low_stock") return value ? <span className="badge bg-warning text-dark">Low</span> : <span className="badge bg-success">OK</span>;
  if (key === "status") {
    const color = { pending: "warning", processing: "info", delivered: "success", cancelled: "danger", shipped: "primary", received: "success" };
    return <span className={`badge bg-${color[value] || "secondary"}`}>{String(value)}</span>;
  }
  return String(value);
}

function extractRows(reportKey, data) {
  if (!data) return [];
  if (reportKey === "inventory/valuation") {
    if (data.level === "warehouse" && Array.isArray(data.data)) return data.data;
    if (data.level === "product" && data.data) return [data.data];
    return [];
  }
  if (reportKey === "purchases/summary") return [data];
  if (reportKey === "financial/summary") return [data];
  if (reportKey === "financial/expenses" && data.expenses) return data.expenses;
  if (Array.isArray(data)) return data;
  return [];
}

function getExportType(reportKey) {
  for (const group of REPORT_GROUPS) {
    const found = group.reports.find((r) => r.key === reportKey);
    if (found) return found.exportType;
  }
  return null;
}

export default function AdminReports() {
  const [activeTab, setActiveTab] = useState("overview");
  const [stats, setStats] = useState({
    totalRevenue: 0,
    totalOrders: 0,
    pendingPayments: 0,
  });
  const [monthlyData, setMonthlyData] = useState([]);
  const [topProducts, setTopProducts] = useState([]);
  const [loading, setLoading] = useState(true);
  const [downloading, setDownloading] = useState("");
  const [error, setError] = useState("");

  const [advReport, setAdvReport] = useState("sales/daily");
  const [advData, setAdvData] = useState(null);
  const [advLoading, setAdvLoading] = useState(false);
  const [advError, setAdvError] = useState("");
  const [advExporting, setAdvExporting] = useState(false);

  const [expForm, setExpForm] = useState({ category: "", amount: "", description: "", expense_date: "" });
  const [expSubmitting, setExpSubmitting] = useState(false);
  const [expMsg, setExpMsg] = useState("");

  const fetchData = useCallback(async () => {
    try {
      setLoading(true);
      setError("");
      const res = await api.get("/reports/summary");
      setStats(res.data.stats || {});
      setMonthlyData(res.data.monthlyData || []);
      setTopProducts(res.data.topProducts || []);
    } catch (err) {
      console.error(err);
      setError("Failed to load report data");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  const fetchAdvanced = useCallback(async (key) => {
    try {
      setAdvLoading(true);
      setAdvError("");
      setAdvData(null);
      const res = await api.get(`/reports/advanced/${key}`);
      setAdvData(res.data);
    } catch (err) {
      console.error(err);
      setAdvError(err.response?.data?.error || "Failed to load report");
    } finally {
      setAdvLoading(false);
    }
  }, []);

  useEffect(() => {
    if (activeTab === "advanced") fetchAdvanced(advReport);
  }, [activeTab, advReport, fetchAdvanced]);

  const handleDownload = async (path, filename, label) => {
    try {
      setDownloading(label);
      setError("");
      await downloadReport(path, filename);
    } catch (err) {
      console.error(err);
      setError(err.message || `Failed to download ${label}`);
    } finally {
      setDownloading("");
    }
  };

  const handleExportXLSX = async () => {
    const exportType = getExportType(advReport);
    if (!exportType) return;
    try {
      setAdvExporting(true);
      setAdvError("");
      const today = new Date().toISOString().slice(0, 10);
      await downloadReport(`/reports/advanced/export/${exportType}`, `${exportType}_report-${today}.xlsx`);
    } catch (err) {
      console.error(err);
      setAdvError(err.message || "Export failed");
    } finally {
      setAdvExporting(false);
    }
  };

  const handleExpenseSubmit = async (e) => {
    e.preventDefault();
    if (!expForm.description || !expForm.amount) {
      setExpMsg("Description and amount are required");
      return;
    }
    try {
      setExpSubmitting(true);
      setExpMsg("");
      await api.post("/reports/advanced/financial/expenses", {
        description: expForm.description,
        amount: Number(expForm.amount),
        category: expForm.category || null,
        notes: expForm.expense_date || null,
      });
      setExpMsg("Expense recorded successfully");
      setExpForm({ category: "", amount: "", description: "", expense_date: "" });
      fetchAdvanced("financial/expenses");
    } catch (err) {
      console.error(err);
      setExpMsg(err.response?.data?.error || "Failed to add expense");
    } finally {
      setExpSubmitting(false);
    }
  };

  const handleExpenseChange = (e) => {
    setExpForm((prev) => ({ ...prev, [e.target.name]: e.target.value }));
  };

  const currentReportDef = REPORT_GROUPS.flatMap((g) => g.reports).find((r) => r.key === advReport);
  const advRows = extractRows(advReport, advData);
  const advColumns = currentReportDef?.columns?.length
    ? currentReportDef.columns
    : advRows.length > 0
    ? Object.keys(advRows[0]).filter((k) => k !== "id" && !k.endsWith("_id"))
    : [];
  const exportTypeForCurrent = getExportType(advReport);

  return (
    <div style={styles.page}>
      <h2 style={styles.title}>Business Reports</h2>

      <ul className="nav nav-tabs mb-4">
        <li className="nav-item">
          <button
            className={`nav-link${activeTab === "overview" ? " active" : ""}`}
            onClick={() => setActiveTab("overview")}
          >
            Overview
          </button>
        </li>
        <li className="nav-item">
          <button
            className={`nav-link${activeTab === "advanced" ? " active" : ""}`}
            onClick={() => setActiveTab("advanced")}
          >
            Advanced
          </button>
        </li>
      </ul>

      {activeTab === "overview" && (
        <>
          {loading && <Skeleton type="table" rows={6} />}

          {!loading && error && <div className="alert alert-danger">{error}</div>}

          {!loading && (
            <>
              <div style={styles.section}>
                <h3>Download Reports</h3>
                <div style={styles.buttonRow}>
                  <button
                    style={styles.btnPrimary}
                    disabled={!!downloading}
                    onClick={() => handleDownload("/reports/orders/pdf", "orders-report.pdf", "pdf")}
                  >
                    {downloading === "pdf" ? "Downloading..." : "Orders PDF"}
                  </button>
                  <button
                    style={styles.btnSecondary}
                    disabled={!!downloading}
                    onClick={() => handleDownload("/reports/orders/csv", "orders-report.csv", "orders-csv")}
                  >
                    {downloading === "orders-csv" ? "Downloading..." : "Orders CSV"}
                  </button>
                  <button
                    style={styles.btnSecondary}
                    disabled={!!downloading}
                    onClick={() => handleDownload("/reports/products/csv", "products-report.csv", "products-csv")}
                  >
                    {downloading === "products-csv" ? "Downloading..." : "Products CSV"}
                  </button>
                </div>
              </div>

              <div style={styles.grid}>
                <Card title="Total Revenue" value={`₹${Number(stats.totalRevenue || 0).toLocaleString()}`} />
                <Card title="Total Orders" value={stats.totalOrders || 0} />
                <Card title="Pending Payments" value={stats.pendingPayments || 0} />
              </div>

              <div style={styles.section}>
                <h3>Monthly Revenue (Paid Orders)</h3>
                {monthlyData.length === 0 ? (
                  <p>No revenue data yet</p>
                ) : (
                  <ResponsiveContainer width="100%" height={300}>
                    <LineChart data={monthlyData}>
                      <XAxis dataKey="month" stroke={cssVar("--text-muted", "#94a3b8")} tick={{ fill: cssVar("--text-secondary", "#64748b") }} />
                      <YAxis stroke={cssVar("--text-muted", "#94a3b8")} tick={{ fill: cssVar("--text-secondary", "#64748b") }} />
                      <Tooltip contentStyle={{ background: "var(--surface)", border: "1px solid var(--border)", borderRadius: 8, color: "var(--text)" }} labelStyle={{ color: "var(--text)" }} />
                      <CartesianGrid stroke={cssVar("--chart-grid", "#e2e8f0")} />
                      <Line type="monotone" dataKey="revenue" stroke={cssVar("--brand", "#3b82f6")} strokeWidth={2.5} dot={{ r: 3 }} />
                    </LineChart>
                  </ResponsiveContainer>
                )}
              </div>

              <div style={styles.section}>
                <h3>Top Products</h3>
                {topProducts.length === 0 ? (
                  <p>No sales data available</p>
                ) : (
                  topProducts.map((p) => (
                    <div key={p.name} style={styles.row}>
                      <span>{p.name}</span>
                      <span>{p.quantity} sold</span>
                    </div>
                  ))
                )}
              </div>
            </>
          )}
        </>
      )}

      {activeTab === "advanced" && (
        <div className="card p-3">
          <div className="d-flex flex-wrap align-items-center gap-2 mb-3">
            <FiFilter />
            <select
              className="form-select"
              style={{ maxWidth: 320 }}
              value={advReport}
              onChange={(e) => setAdvReport(e.target.value)}
            >
              {REPORT_GROUPS.map((grp) => (
                <optgroup key={grp.label} label={grp.label}>
                  {grp.reports.map((r) => (
                    <option key={r.key} value={r.key}>{r.title}</option>
                  ))}
                </optgroup>
              ))}
            </select>

            <button
              className="btn btn-outline-primary btn-sm"
              disabled={advExporting || !exportTypeForCurrent}
              title={exportTypeForCurrent ? "Download XLSX" : "No XLSX export for this report"}
              onClick={handleExportXLSX}
            >
              <FiDownload className="me-1" />
              {advExporting ? "Exporting..." : "Download XLSX"}
            </button>
          </div>

          {advLoading && <Skeleton type="table" rows={5} />}

          {!advLoading && advError && <div className="alert alert-danger">{advError}</div>}

          {!advLoading && !advError && advRows.length === 0 && (
            <EmptyState icon="📊" title="No data" sub="This report returned no results." />
          )}

          {!advLoading && !advError && advRows.length > 0 && (
            <div className="table-responsive">
              <table className="table table-bordered table-hover align-middle mb-0">
                <thead className="table-light">
                  <tr>
                    {advColumns.map((col) => (
                      <th key={col} className="text-nowrap text-capitalize">
                        {col.replace(/_/g, " ")}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {advRows.map((row, idx) => (
                    <tr key={idx}>
                      {advColumns.map((col) => (
                        <td key={col}>{formatCell(col, row[col])}</td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          {advReport === "financial/expenses" && (
            <div className="mt-4">
              <h5 className="mb-3">Record Expense</h5>
              {expMsg && (
                <div className={`alert ${expMsg.includes("success") ? "alert-success" : "alert-danger"} alert-dismissible`}>
                  {expMsg}
                </div>
              )}
              <form onSubmit={handleExpenseSubmit} className="row g-3">
                <div className="col-md-3">
                  <label className="form-label text-muted small">Category</label>
                  <select
                    className="form-select"
                    name="category"
                    value={expForm.category}
                    onChange={handleExpenseChange}
                  >
                    <option value="">Select category</option>
                    {EXPENSE_CATEGORIES.map((c) => (
                      <option key={c} value={c}>{c}</option>
                    ))}
                  </select>
                </div>
                <div className="col-md-2">
                  <label className="form-label text-muted small">Amount</label>
                  <input
                    type="number"
                    className="form-control"
                    name="amount"
                    value={expForm.amount}
                    onChange={handleExpenseChange}
                    placeholder="0.00"
                    min="0"
                    step="0.01"
                    required
                  />
                </div>
                <div className="col-md-4">
                  <label className="form-label text-muted small">Description</label>
                  <input
                    type="text"
                    className="form-control"
                    name="description"
                    value={expForm.description}
                    onChange={handleExpenseChange}
                    placeholder="Expense description"
                    required
                  />
                </div>
                <div className="col-md-2">
                  <label className="form-label text-muted small">Date</label>
                  <input
                    type="date"
                    className="form-control"
                    name="expense_date"
                    value={expForm.expense_date}
                    onChange={handleExpenseChange}
                  />
                </div>
                <div className="col-md-1 d-flex align-items-end">
                  <button type="submit" className="btn btn-success w-100" disabled={expSubmitting}>
                    <FiPlus className="me-1" />
                    {expSubmitting ? "Adding..." : "Add"}
                  </button>
                </div>
              </form>
            </div>
          )}
        </div>
      )}

      <style>
        {`
        .hoverCard:hover {
          transform: translateY(-6px);
          box-shadow: 0 12px 30px rgba(0,0,0,0.1);
          transition: 0.3s;
        }
        `}
      </style>
    </div>
  );
}

function Card({ title, value }) {
  return (
    <div style={styles.card} className="hoverCard">
      <p>{title}</p>
      <h2>{value}</h2>
    </div>
  );
}

const styles = {
  page: {
    padding: "40px",
    background: "var(--bg)",
    minHeight: "100vh",
    fontFamily: "var(--font)",
    color: "var(--text)",
  },
  title: {
    fontSize: "28px",
    marginBottom: "20px",
  },
  grid: {
    display: "grid",
    gridTemplateColumns: "repeat(auto-fit, minmax(200px, 1fr))",
    gap: "20px",
    marginBottom: "30px",
  },
  card: {
    background: "var(--surface)",
    color: "var(--text)",
    padding: "20px",
    borderRadius: "var(--radius-lg)",
    boxShadow: "var(--shadow)",
    border: "1px solid var(--border)",
  },
  section: {
    background: "var(--surface)",
    color: "var(--text)",
    padding: "20px",
    borderRadius: "var(--radius-lg)",
    marginBottom: "20px",
    boxShadow: "var(--shadow)",
    border: "1px solid var(--border)",
  },
  buttonRow: {
    display: "flex",
    flexWrap: "wrap",
    gap: "12px",
  },
  btnPrimary: {
    background: "var(--brand)",
    color: "#fff",
    border: "none",
    padding: "10px 18px",
    borderRadius: "var(--radius-sm)",
    cursor: "pointer",
    fontSize: "14px",
    fontWeight: 600,
  },
  btnSecondary: {
    background: "transparent",
    color: "var(--brand)",
    border: "1px solid var(--brand)",
    padding: "10px 18px",
    borderRadius: "var(--radius-sm)",
    cursor: "pointer",
    fontSize: "14px",
    fontWeight: 600,
  },
  row: {
    display: "flex",
    justifyContent: "space-between",
    padding: "10px 0",
    borderBottom: "1px solid var(--border)",
  },
};
