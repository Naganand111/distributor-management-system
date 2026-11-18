import React, { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import api from "../lib/api";
import { useToast } from "./ui";

export default function AdminSalesOrders() {
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(true);
  const [paymentOrder, setPaymentOrder] = useState(null);
  const [payAmount, setPayAmount] = useState("");
  const [payNote, setPayNote] = useState("");
  const toast = useToast();

  const load = async () => {
    setLoading(true);
    try {
      const res = await api.get("/dms/sales-orders");
      setRows(Array.isArray(res.data) ? res.data : []);
    } catch (err) {
      console.error("Load sales orders error:", err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    load();
  }, []);

  const openPayment = (o) => {
    setPaymentOrder(o);
    const due =
      Number(o.total_amount || 0) - Number(o.discount || 0) - Number(o.paid_amount || 0);
    setPayAmount(due > 0 ? String(due) : "");
    setPayNote("");
  };

  const submitPayment = async (e) => {
    e.preventDefault();
    try {
      await api.post(`/dms/orders/${paymentOrder.id}/payment`, {
        amount: Number(payAmount),
        method: "cash",
        note: payNote || null,
      });
      setPaymentOrder(null);
      load();
    } catch (err) {
      toast.error(err.response?.data?.error || "Payment failed");
    }
  };

  const fmt = (n) => `₹${Number(n || 0).toFixed(2)}`;

  return (
    <div className="container-fluid py-4">
      <div className="d-flex justify-content-between align-items-center mb-4">
        <h2 className="mb-0">Sales Orders</h2>
        <button className="btn btn-outline-secondary" onClick={load}>
          Refresh
        </button>
      </div>

      {loading ? (
        <div className="loading">Loading...</div>
      ) : (
        <table className="table table-striped shadow-sm">
          <thead>
            <tr>
              <th>#</th>
              <th>Retailer</th>
              <th>Salesman</th>
              <th>Total</th>
              <th>Paid</th>
              <th>Status</th>
              <th>Payment</th>
              <th>Invoice</th>
              <th>Actions</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((o) => {
              const due = Number(o.total_amount || 0) - Number(o.discount || 0) - Number(o.paid_amount || 0);
              return (
                <tr key={o.id}>
                  <td>{o.id}</td>
                  <td>
                    {o.retailer_name || o.customer_name}
                    {o.retailer_shop ? <div className="small text-muted">{o.retailer_shop}</div> : null}
                  </td>
                  <td>{o.salesman || "—"}</td>
                  <td>{fmt(o.total_amount - (o.discount || 0))}</td>
                  <td>{fmt(o.paid_amount)}</td>
                  <td>
                    <span className={`status ${o.status}`}>{o.status}</span>
                  </td>
                  <td>
                    <span className={`status ${o.payment_status || "pending"}`}>
                      {o.payment_status || "pending"}
                    </span>
                  </td>
                  <td>
                    {o.invoice_no ? (
                      <Link to="/admin/invoices" className="small">
                        {o.invoice_no}
                      </Link>
                    ) : (
                      "—"
                    )}
                  </td>
                  <td>
                    <button
                      className="btn btn-sm btn-outline-primary me-1"
                      onClick={() => openPayment(o)}
                      disabled={due <= 0}
                    >
                      Pay
                    </button>
                    <Link
                      to={`/admin/order-tracking?id=${o.id}`}
                      className="btn btn-sm btn-outline-secondary"
                    >
                      Track
                    </Link>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      )}

      {/* PAYMENT MODAL */}
      {paymentOrder && (
        <div
          style={{
            position: "fixed",
            inset: 0,
            background: "rgba(0,0,0,.5)",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            zIndex: 999,
          }}
          onClick={() => setPaymentOrder(null)}
        >
          <form
            className="card p-4 shadow"
            style={{ width: 400 }}
            onClick={(e) => e.stopPropagation()}
            onSubmit={submitPayment}
          >
            <h5>Record Payment</h5>
            <p className="text-muted">
              Order #{paymentOrder.id} — {paymentOrder.retailer_name || ""}
            </p>
            <label className="small">Amount (₹)</label>
            <input
              type="number"
              min="1"
              step="0.01"
              className="form-control mb-2"
              value={payAmount}
              onChange={(e) => setPayAmount(e.target.value)}
              required
            />
            <label className="small">Note</label>
            <input
              className="form-control mb-3"
              value={payNote}
              onChange={(e) => setPayNote(e.target.value)}
            />
            <div className="d-flex gap-2 justify-content-end">
              <button
                type="button"
                className="btn btn-secondary"
                onClick={() => setPaymentOrder(null)}
              >
                Cancel
              </button>
              <button className="btn btn-primary" type="submit">
                Save Payment
              </button>
            </div>
          </form>
        </div>
      )}
    </div>
  );
}