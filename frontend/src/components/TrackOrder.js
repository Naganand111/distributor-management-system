import React, { useEffect, useState } from "react";
import { useParams, Link } from "react-router-dom";
import api from "../lib/api";
import { formatDate } from "../lib/utils";
import OrderStatusTimeline, { StatusBadge } from "./OrderStatusTimeline";

export default function TrackOrder() {
  const { id } = useParams();
  const [data, setData] = useState(null);
  const [error, setError] = useState("");

  useEffect(() => {
    api
      .get(`/orders/${id}/tracking`)
      .then((res) => setData(res.data))
      .catch((err) => setError(err.response?.data?.error || "Could not load tracking"))
      .finally(() => {});
  }, [id]);

  if (error) return <div className="alert alert-danger">{error}</div>;
  if (!data) return <div className="text-center py-5 text-muted">Loading tracking…</div>;

  const { order, history } = data;

  return (
    <div>
      <nav className="mb-3"><Link to={`/my-orders/${order.id}`} className="text-decoration-none">← Order Details</Link></nav>

      <div className="card shadow-sm cust-card mb-4">
        <div className="card-body">
          <div className="d-flex justify-content-between align-items-center flex-wrap mb-2">
            <div>
              <h4 className="mb-0 fw-bold">Track Order #{order.id}</h4>
              <div className="text-muted small">{formatDate(order.created_at)} · {order.items_count || 0} item(s)</div>
            </div>
            <div className="d-flex align-items-center gap-2">
              <StatusBadge status={order.status} />
            </div>
          </div>

          <OrderStatusTimeline status={order.status} history={history} />

          {order.shipping_address && (
            <div className="mt-3 p-3 rounded" style={{ background: "var(--surface-2)", border: "1px solid var(--border)" }}>
              <div className="fw-semibold mb-1">Shipping Address</div>
              <div className="small text-muted">
                {order.shipping_name} {order.shipping_mobile && `· ${order.shipping_mobile}`}<br />
                {order.shipping_address}, {order.shipping_city} {order.shipping_state} {order.shipping_pincode}
              </div>
            </div>
          )}
        </div>
      </div>

      <style>{`.cust-card{border:1px solid var(--border);border-radius:16px;overflow:hidden;background:var(--surface);}`}</style>
    </div>
  );
}
