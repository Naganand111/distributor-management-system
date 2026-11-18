import React, { useEffect, useState } from "react";
import { useSearchParams, Link } from "react-router-dom";
import api from "../lib/api";
import { useToast } from "./ui";

const NEXT_STATUS = {
  pending: ["processing", "confirmed", "cancelled"],
  processing: ["confirmed", "shipped", "cancelled"],
  confirmed: ["shipped", "delivered", "cancelled"],
  shipped: ["delivered"],
  delivered: [],
  cancelled: [],
};

export default function AdminOrderTracking() {
  const [params] = useSearchParams();
  const [orderId, setOrderId] = useState(params.get("id") || "");
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const toast = useToast();

  const load = async (id) => {
    if (!id) return;
    setLoading(true);
    setError(null);
    try {
      const res = await api.get(`/dms/orders/${id}/tracking`);
      setData(res.data);
    } catch (err) {
      setError(err.response?.data?.error || "Failed to load tracking");
      setData(null);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    load(orderId);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [orderId]);

  const submit = (e) => {
    e.preventDefault();
    load(orderId);
  };

  const changeStatus = async (status) => {
    const note = window.prompt("Note for status change (optional):", "") || "";
    try {
      await api.put(`/orders/${orderId}/status`, { status, note });
      load(orderId);
    } catch (err) {
      toast.error(err.response?.data?.error || "Status update failed");
    }
  };

  const fmt = (n) => `₹${Number(n || 0).toFixed(2)}`;
  const fmtDate = (d) => (d ? new Date(d).toLocaleString() : "");

  const order = data?.order;

  return (
    <div className="container-fluid py-4">
      <div className="d-flex justify-content-between align-items-center mb-4">
        <h2 className="mb-0">Order Tracking</h2>
        <Link to="/admin/sales-orders" className="btn btn-outline-secondary">
          ← Back
        </Link>
      </div>

      <form onSubmit={submit} className="row g-2 mb-4">
        <div className="col-md-4">
          <input
            type="number"
            className="form-control"
            placeholder="Order ID"
            value={orderId}
            onChange={(e) => setOrderId(e.target.value)}
          />
        </div>
        <div className="col-md-2">
          <button className="btn btn-primary w-100">Track</button>
        </div>
      </form>

      {error && <div className="alert alert-danger">{error}</div>}
      {loading && <div className="loading">Loading...</div>}

      {data && order && (
        <div className="row">
          <div className="col-md-5">
            <div className="card p-3 shadow-sm mb-3">
              <h5>Order #{order.id}</h5>
              <table className="table table-sm mb-0">
                <tbody>
                  <tr>
                    <td className="text-muted">Retailer</td>
                    <td>{order.retailer_name || order.customer_name}</td>
                  </tr>
                  <tr>
                    <td className="text-muted">Shop</td>
                    <td>{order.retailer_shop || "—"}</td>
                  </tr>
                  <tr>
                    <td className="text-muted">Salesman</td>
                    <td>{order.salesman || order.salesman_name || "—"}</td>
                  </tr>
                  <tr>
                    <td className="text-muted">Order Date</td>
                    <td>{fmtDate(order.created_at)}</td>
                  </tr>
                  <tr>
                    <td className="text-muted">Total</td>
                    <td>{fmt(order.total_amount - (order.discount || 0))}</td>
                  </tr>
                  <tr>
                    <td className="text-muted">Paid</td>
                    <td>{fmt(order.paid_amount)}</td>
                  </tr>
                  <tr>
                    <td className="text-muted">Payment</td>
                    <td>
                      <span className={`status ${order.payment_status || "pending"}`}>
                        {order.payment_status || "pending"}
                      </span>
                    </td>
                  </tr>
                  <tr>
                    <td className="text-muted">Notes</td>
                    <td>{order.notes || "—"}</td>
                  </tr>
                </tbody>
              </table>
            </div>

            {NEXT_STATUS[order.status]?.length > 0 && (
              <div className="card p-3 shadow-sm">
                <h6>Update Status</h6>
                {NEXT_STATUS[order.status].map((s) => (
                  <button
                    key={s}
                    className="btn btn-sm btn-outline-primary me-2 mb-2"
                    onClick={() => changeStatus(s)}
                  >
                    Move to {s}
                  </button>
                ))}
              </div>
            )}
          </div>

          <div className="col-md-7">
            <div className="card p-3 shadow-sm">
              <h5>Timeline</h5>
              {data.history.length === 0 ? (
                <p className="text-muted">No status history yet.</p>
              ) : (
                <div className="timeline">
                  {data.history.map((h, i) => (
                    <div key={h.id} className="timeline-item">
                      <div className="d-flex justify-content-between">
                        <strong>
                          <span className={`status ${h.status}`}>{h.status}</span>
                        </strong>
                        <small className="text-muted">{fmtDate(h.created_at)}</small>
                      </div>
                      <div className="small">
                        {h.note ? <span>{h.note} — </span> : null}
                        by {h.changed_by_name || "—"}
                      </div>
                      {i < data.history.length - 1 && <hr className="my-2" />}
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}