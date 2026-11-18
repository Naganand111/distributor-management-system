import React, { useEffect, useState, useCallback } from "react";
import api from "../lib/api";
import { formatINR, formatDate } from "../lib/utils";
import { Skeleton, EmptyState } from "./ui";

const METHODS = ["", "cash", "online", "upi", "card", "bank_transfer", "cheque", "credit"];

export default function AdminPayments() {
  const [rows, setRows] = useState([]);
  const [summary, setSummary] = useState(null);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [method, setMethod] = useState("");
  const [status, setStatus] = useState("");
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [error, setError] = useState("");

  const load = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const params = new URLSearchParams();
      if (search) params.set("search", search);
      if (method) params.set("method", method);
      if (status) params.set("status", status);
      if (from) params.set("from", from);
      if (to) params.set("to", to);

      const res = await api.get(`/dms/payments?${params.toString()}`);
      setSummary(res.data.summary || null);
      setRows(Array.isArray(res.data.data) ? res.data.data : []);
    } catch (err) {
      setError(err.response?.data?.error || "Failed to load payments");
    } finally {
      setLoading(false);
    }
  }, [search, method, status, from, to]);

  useEffect(() => {
    load();
  }, [load]);

  return (
    <div>
      <div className="d-flex flex-wrap justify-content-between align-items-center gap-3 mb-3">
        <div>
          <h2 className="mb-1">Payments</h2>
          <div className="text-muted small">All customer payments across orders</div>
        </div>
      </div>

      {error && <div className="alert alert-danger">{error}</div>}

      {/* SUMMARY CARDS */}
      <div className="row g-3 mb-4">
        <div className="col-md-3">
          <div className="card p-3">
            <div className="text-muted small">Total Payments</div>
            <h4 className="mb-0">{summary ? summary.totalPayments : "—"}</h4>
          </div>
        </div>
        <div className="col-md-3">
          <div className="card p-3">
            <div className="text-muted small">Collected</div>
            <h4 className="mb-0 text-success">{summary ? formatINR(summary.totalCollected) : "—"}</h4>
          </div>
        </div>
        <div className="col-md-3">
          <div className="card p-3">
            <div className="text-muted small">Paying Customers</div>
            <h4 className="mb-0">{summary ? summary.payingCustomers : "—"}</h4>
          </div>
        </div>
        <div className="col-md-3">
          <div className="card p-3">
            <div className="text-muted small">Paid Orders</div>
            <h4 className="mb-0">{summary ? summary.paidOrders : "—"}</h4>
          </div>
        </div>
      </div>

      {/* FILTERS */}
      <div className="card p-3 mb-3">
        <div className="row g-2">
          <div className="col-md-4">
            <input
              className="form-control"
              placeholder="Search invoice / order id / customer"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
            />
          </div>
          <div className="col-md-2">
            <select className="form-select" value={method} onChange={(e) => setMethod(e.target.value)}>
              {METHODS.map((m) => (
                <option key={m || "all"} value={m}>{m ? m.replace("_", " ") : "All Methods"}</option>
              ))}
            </select>
          </div>
          <div className="col-md-2">
            <select className="form-select" value={status} onChange={(e) => setStatus(e.target.value)}>
              <option value="">All Statuses</option>
              <option value="paid">Paid</option>
              <option value="pending">Pending</option>
              <option value="partial">Partial</option>
            </select>
          </div>
          <div className="col-md-2">
            <input className="form-control" type="date" value={from} onChange={(e) => setFrom(e.target.value)} aria-label="From date" />
          </div>
          <div className="col-md-2">
            <input className="form-control" type="date" value={to} onChange={(e) => setTo(e.target.value)} aria-label="To date" />
          </div>
        </div>
      </div>

      {loading ? (
        <Skeleton type="card" rows={6} />
      ) : rows.length === 0 ? (
        <EmptyState title="No payments found" sub="Try adjusting your filters, or record a payment from an order." icon="💳" />
      ) : (
        <div className="card shadow-sm">
          <div className="table-responsive">
            <table className="table table-hover align-middle mb-0">
              <thead>
                <tr>
                  <th>Receipt</th>
                  <th>Invoice</th>
                  <th>Order</th>
                  <th>Customer</th>
                  <th>Amount</th>
                  <th>Method</th>
                  <th>Paid On</th>
                  <th>Order Status</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((p) => (
                  <tr key={p.id}>
                    <td>#{p.id}</td>
                    <td>{p.invoice_no || "—"}</td>
                    <td>#{p.order_id}</td>
                    <td>{p.customer}</td>
                    <td className="fw-semibold">{formatINR(p.amount)}</td>
                    <td><span className="payment-method">{p.method}</span></td>
                    <td className="small text-muted">{formatDate(p.payment_date)}</td>
                    <td>
                      <span className={`badge ${String(p.payment_status) === "paid" ? "bg-success" : String(p.payment_status) === "pending" ? "bg-warning text-dark" : "bg-info text-dark"}`}>
                        {p.payment_status}
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}