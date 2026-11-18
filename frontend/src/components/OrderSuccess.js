import React, { useEffect, useState } from "react";
import { useParams, Link } from "react-router-dom";
import api from "../lib/api";
import { formatINR, formatDate } from "../lib/utils";
import { StatusBadge } from "./OrderStatusTimeline";

export default function OrderSuccess() {
  const { id } = useParams();
  const [order, setOrder] = useState(null);
  const [error, setError] = useState("");

  useEffect(() => {
    api
      .get(`/orders/${id}`)
      .then((res) => {
        const o = res.data?.order || res.data;
        setOrder(o);
      })
      .catch(() => setError("Could not load order details"))
      .finally(() => {});
  }, [id]);

  return (
    <div className="text-center py-5">
      <div className="mb-2" style={{ fontSize: 72 }}>✅</div>
      <h2 className="fw-bold">Order Placed Successfully!</h2>
      <p className="text-muted">Thank you for your order. We'll process it shortly.</p>

      {error ? (
        <div className="alert alert-danger d-inline-block mt-2">{error}</div>
      ) : order ? (
        <div className="card shadow-sm cust-card mx-auto mt-3" style={{ maxWidth: 420 }}>
          <div className="card-body text-start">
            <div className="d-flex justify-content-between pb-1"><span className="text-muted">Order ID</span><span className="fw-semibold">#{order.id}</span></div>
            <div className="d-flex justify-content-between pb-1">
              <span className="text-muted">Invoice Number</span>
              <span className="fw-semibold">INV-{String(order.id).padStart(6, "0")}</span>
            </div>
            <div className="d-flex justify-content-between pb-1"><span className="text-muted">Total Amount</span><span className="fw-semibold">{formatINR(Number(order.total_amount) - Number(order.discount))}</span></div>
            <div className="d-flex justify-content-between pb-1"><span className="text-muted">Payment Status</span><span className="badge bg-success">{order.payment_status}</span></div>
            <div className="d-flex justify-content-between pb-1"><span className="text-muted">Order Status</span><StatusBadge status={order.status} /></div>
            <div className="d-flex justify-content-between"><span className="text-muted">Date</span><span>{formatDate(order.created_at)}</span></div>
          </div>
        </div>
      ) : (
        <p className="text-muted">Loading order…</p>
      )}

      <div className="mt-4 d-flex justify-content-center gap-3">
        <Link to={`/my-orders/${id}`} className="btn btn-primary customer-btn">View Order</Link>
        <Link to="/shop" className="btn btn-outline-primary customer-btn">Continue Shopping</Link>
      </div>

      <style>{`.customer-btn { border-radius:999px; }`}</style>
    </div>
  );
}
