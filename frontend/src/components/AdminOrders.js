import React, { useState, useEffect, useCallback } from "react";
import api from "../lib/api";
import { StatusBadge } from "./OrderStatusTimeline";

// Allowed next-status options for each current status (matches the backend
// transition table in backend/utils/orderTotals.js).
const TRANSITIONS = {
  pending: [
    { value: "processing", label: "Processing" },
    { value: "confirmed", label: "Confirmed" },
    { value: "cancelled", label: "Cancelled" },
  ],
  processing: [
    { value: "confirmed", label: "Confirmed" },
    { value: "shipped", label: "Shipped" },
    { value: "cancelled", label: "Cancelled" },
  ],
  confirmed: [
    { value: "shipped", label: "Shipped" },
    { value: "delivered", label: "Delivered" },
    { value: "cancelled", label: "Cancelled" },
  ],
  shipped: [{ value: "delivered", label: "Delivered" }],
  delivered: [],
  cancelled: [],
};

const STATUS_OPTIONS = [
  "",
  "pending",
  "processing",
  "confirmed",
  "shipped",
  "delivered",
  "cancelled",
];

const PAGE_SIZE = 20;

export default function AdminOrders() {
  const [orders, setOrders] = useState([]);
  const [pagination, setPagination] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  const [page, setPage] = useState(1);
  const [status, setStatus] = useState("");
  const [search, setSearch] = useState("");

  const fetchOrders = useCallback(async () => {
    try {
      setLoading(true);
      setError("");
      const response = await api.get("/orders", {
        params: {
          page,
          limit: PAGE_SIZE,
          ...(status ? { status } : {}),
          ...(search.trim() ? { q: search.trim() } : {}),
        },
      });
      setOrders(response.data.orders || []);
      setPagination(response.data.pagination || null);
    } catch (err) {
      setError(err.response?.data?.error || "Failed to fetch orders");
    } finally {
      setLoading(false);
    }
  }, [page, status, search]);

  useEffect(() => {
    fetchOrders();
  }, [fetchOrders]);

  const applyFilter = (setter) => (value) => {
    setPage(1);
    setter(value);
  };

  const updateOrderStatus = async (orderId, newStatus) => {
    try {
      setError("");
      await api.put(`/orders/${orderId}/status`, { status: newStatus });
      await fetchOrders();
    } catch (err) {
      setError(err.response?.data?.error || "Failed to update order status");
    }
  };

  return (
    <div className="container-fluid p-4">
      <h2 className="mb-4">Orders Management</h2>

      {error && <div className="alert alert-danger">{error}</div>}

      <div className="card shadow-sm">
        <div className="card-body">
          <div className="row g-2 mb-3">
            <div className="col-sm-4">
              <input
                className="form-control form-control-sm"
                placeholder="Search by order id or customer…"
                value={search}
                onChange={(e) => applyFilter(setSearch)(e.target.value)}
              />
            </div>
            <div className="col-sm-3">
              <select
                className="form-select form-select-sm"
                value={status}
                onChange={(e) => applyFilter(setStatus)(e.target.value)}
              >
                {STATUS_OPTIONS.map((s) => (
                  <option key={s} value={s}>
                    {s ? s[0].toUpperCase() + s.slice(1) : "All statuses"}
                  </option>
                ))}
              </select>
            </div>
          </div>

          {loading ? (
            <div className="text-center py-4">
              <div className="spinner-border text-primary"></div>
            </div>
          ) : (
            <div className="table-responsive">
              <table className="table table-hover">
                <thead>
                  <tr>
                    <th>ID</th>
                    <th>Customer</th>
                    <th>Date</th>
                    <th>Total</th>
                    <th>Payment</th>
                    <th>Status</th>
                    <th>Action</th>
                  </tr>
                </thead>

                <tbody>
                  {orders.length === 0 && (
                    <tr>
                      <td colSpan={7} className="text-center text-muted py-4">
                        No orders match these filters.
                      </td>
                    </tr>
                  )}
                  {orders.map((order) => (
                    <tr key={order.id}>
                      <td>#{order.id}</td>

                      <td>
                        <b>{order.customer || order.customer_name || "—"}</b>
                      </td>

                      <td>{new Date(order.created_at).toLocaleDateString()}</td>

                      {/* grand_total is the server-calculated payable amount. */}
                      <td>₹{Number(order.grand_total ?? order.total_amount).toFixed(2)}</td>

                      <td className="text-capitalize small">{order.payment_status}</td>

                      <td>
                        <StatusBadge status={order.status} />
                      </td>

                      <td>
                        {TRANSITIONS[order.status]?.length > 0 ? (
                          <select
                            className="form-select form-select-sm"
                            value=""
                            onChange={(e) => updateOrderStatus(order.id, e.target.value)}
                          >
                            <option value="" disabled>
                              Update status…
                            </option>
                            {TRANSITIONS[order.status].map((t) => (
                              <option key={t.value} value={t.value}>
                                {t.label}
                              </option>
                            ))}
                          </select>
                        ) : (
                          <span className="text-muted small">No changes</span>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          {pagination && pagination.total_pages > 1 && (
            <div className="d-flex justify-content-between align-items-center">
              <span className="small text-muted">
                Page {pagination.page} of {pagination.total_pages} ({pagination.total} orders)
              </span>
              <div className="btn-group">
                <button
                  className="btn btn-sm btn-light"
                  disabled={page <= 1}
                  onClick={() => setPage((p) => Math.max(1, p - 1))}
                >
                  Previous
                </button>
                <button
                  className="btn btn-sm btn-light"
                  disabled={page >= pagination.total_pages}
                  onClick={() => setPage((p) => p + 1)}
                >
                  Next
                </button>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
