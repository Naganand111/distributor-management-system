import React, { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import api from "../lib/api";
import { formatINR, formatDate } from "../lib/utils";

export default function MyPayments() {
  const [payments, setPayments] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  useEffect(() => {
    api
      .get("/payments/my-payments")
      .then((res) => setPayments(Array.isArray(res.data) ? res.data : []))
      .catch(() => setError("Failed to load payments"))
      .finally(() => setLoading(false));
  }, []);

  if (loading) return <div className="text-center py-5 text-muted">Loading payments…</div>;
  if (error) return <div className="alert alert-danger">{error}</div>;

  return (
    <div>
      <h3 className="cust-page-title mb-1">My Payments</h3>
      <p className="text-muted mb-4">{payments.length} payment{payments.length === 1 ? "" : "s"}</p>

      {payments.length === 0 ? (
        <div className="text-center py-5">
          <div style={{ fontSize: 60 }}>💳</div>
          <h4 className="mt-3">No payments recorded</h4>
          <p className="text-muted">Payments you make against orders will appear here.</p>
          <Link to="/my-orders" className="btn btn-primary customer-btn">View Orders</Link>
        </div>
      ) : (
        <div className="card shadow-sm cust-card">
          <div className="table-responsive">
            <table className="table table-hover align-middle mb-0 cust-table">
              <thead>
                <tr>
                  <th>Payment ID</th>
                  <th>Invoice</th>
                  <th>Order</th>
                  <th>Amount</th>
                  <th>Method</th>
                  <th>Date</th>
                  <th>Status</th>
                </tr>
              </thead>
              <tbody>
                {payments.map((p) => (
                  <tr key={p.payment_id}>
                    <td>#{p.payment_id}</td>
                    <td>{p.invoice_no || "—"}</td>
                    <td><Link to={`/my-orders/${p.order_id}`}>#{p.order_id}</Link></td>
                    <td className="fw-semibold">{formatINR(p.amount)}</td>
                    <td><span className="payment-method text-capitalize"><span className="pm-dot" />{p.method}</span></td>
                    <td>{formatDate(p.payment_date)}</td>
                    <td>
                      <span className={`status-badge ${p.payment_status === "paid" ? "status-paid" : "status-unpaid"}`}>{p.payment_status}</span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      <style>{`.customer-btn{border-radius:999px;} .cust-table th{font-size:12px;text-transform:uppercase;color:var(--text-muted);} .cust-card{border:1px solid var(--border);border-radius:16px;overflow:hidden;background:var(--surface);} .payment-method{display:inline-flex;align-items:center;gap:6px;font-weight:600;color:var(--text-secondary);} .pm-dot{width:7px;height:7px;border-radius:50%;background:var(--text-muted);}`}</style>
    </div>
  );
}
