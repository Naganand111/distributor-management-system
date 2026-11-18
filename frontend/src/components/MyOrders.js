import React, { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import api from "../lib/api";
import { formatINR, formatDate } from "../lib/utils";
import { StatusBadge } from "./OrderStatusTimeline";
import { openRazorpay } from "../lib/payment";
import { downloadInvoicePdf } from "../lib/invoice";
import { useToast } from "./ui";

const CANCELABLE = ["pending", "processing", "confirmed"];

const round2 = (n) => Math.round(Number(n || 0) * 100) / 100;

export default function MyOrders() {
  const [orders, setOrders] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [downloadingId, setDownloadingId] = useState(null);
  const [cancelTarget, setCancelTarget] = useState(null);
  const [cancelReason, setCancelReason] = useState("");
  const [cancelling, setCancelling] = useState(false);
  const [wallet, setWallet] = useState(null);
  const [redeemTarget, setRedeemTarget] = useState(null);
  const [redeemPoints, setRedeemPoints] = useState("");
  const [page, setPage] = useState(1);
  const [pageSize] = useState(10);
  const [pagination, setPagination] = useState(null);
  const [redeeming, setRedeeming] = useState(false);
  const toast = useToast();

  useEffect(() => {
    api
      .get("/orders/my-orders", { params: { page, limit: pageSize } })
      .then((res) => {
        setOrders(Array.isArray(res.data?.orders) ? res.data.orders : []);
        setPagination(res.data?.pagination || null);
      })
      .catch(() => setError("Failed to load orders"))
      .finally(() => setLoading(false));
  }, [page, pageSize]);

  useEffect(() => {
    api.get("/loyalty/mine").then((res) => setWallet(res.data)).catch(() => {});
  }, []);

  const redeemOrder = async () => {
    if (!redeemTarget) return;
    const points = Number(redeemPoints);
    if (!points || points <= 0) {
      toast.error("Enter a positive number of points");
      return;
    }
    setRedeeming(true);
    toast.info("Applying points…");
    try {
      const res = await api.post("/loyalty/redeem/mine", { points, order_id: redeemTarget.id });
      const discount = res.data.discount_applied || 0;
      setOrders((prev) => prev.map((x) => (x.id === redeemTarget.id ? { ...x, discount: Number(x.discount || 0) + discount } : x)));
      setWallet((w) => (w ? { ...w, points_balance: Number(w.points_balance) - points, total_redeemed: Number(w.total_redeemed || 0) + points } : w));
      setRedeemTarget(null);
      setRedeemPoints("");
      toast.success(res.data.message || "Points applied");
    } catch (err) {
      toast.error(err.response?.data?.message || "Unable to redeem points");
    } finally {
      setRedeeming(false);
    }
  };

  const retryPayment = async (o) => {
    // Display only. `amount_due` and `grand_total` are server-calculated; the
    // amount actually charged is decided by the server again when the gateway
    // order is created, so nothing here is sent or trusted for pricing.
    const grandTotal = Number(o.grand_total ?? 0);
    const remaining = Number.isFinite(Number(o.amount_due))
      ? Number(o.amount_due)
      : round2(grandTotal - Number(o.paid_amount || 0));
    if (remaining <= 0) {
      alert("This order is already paid.");
      return;
    }
    try {
      await openRazorpay({
        orderId: o.id,
        onSuccess: (result) => {
          setOrders((prev) =>
            prev.map((x) =>
              x.id === o.id
                ? {
                    ...x,
                    payment_status: result?.payment_status || "paid",
                    paid_amount: result?.paid_amount ?? x.paid_amount,
                  }
                : x
            )
          );
          alert("✅ Payment successful");
        },
        onFailure: () => alert("❌ Payment Failed"),
      });
    } catch (err) {
      alert(err.response?.data?.error || "Payment failed");
    }
  };

  const downloadInvoice = async (o) => {
    if (downloadingId) return; // prevent duplicate downloads
    setDownloadingId(o.id);
    toast.info("Generating invoice…");
    try {
      await downloadInvoicePdf(o.id, `${o.invoice_no || `INV-${String(o.id).padStart(6, "0")}`}.pdf`);
      toast.success("Invoice downloaded successfully");
    } catch (err) {
      const status = err.response?.status;
      const msg =
        status === 404
          ? "Invoice not found"
          : status === 403
          ? "You are not authorized to download this invoice"
          : status === 401
          ? "Please login again"
          : "Unable to download invoice. Please try again.";
      toast.error(msg);
    } finally {
      setDownloadingId(null);
    }
  };

  const isPaid = (s) => s === "paid";

  const cancelOrder = async () => {
    if (!cancelTarget) return;
    setCancelling(true);
    toast.info("Cancelling order…");
    try {
      const res = await api.post(`/orders/${cancelTarget.id}/cancel`, { reason: cancelReason });
      setOrders((prev) =>
        prev.map((x) =>
          x.id === cancelTarget.id
            ? { ...x, status: res.data.status || "cancelled", cancelled_at: new Date().toISOString() }
            : x
        )
      );
      setCancelTarget(null);
      setCancelReason("");
      toast.success(`Order #${cancelTarget.id} cancelled successfully`);
    } catch (err) {
      toast.error(err.response?.data?.error || "Unable to cancel order. Please try again.");
    } finally {
      setCancelling(false);
    }
  };

  if (loading) return <div className="text-center py-5 text-muted">Loading your orders…</div>;
  if (error) return <div className="alert alert-danger">{error}</div>;

  return (
    <div>
      <h3 className="cust-page-title mb-1">My Orders</h3>
      <p className="text-muted mb-4">
        {pagination ? `${pagination.total} order${pagination.total === 1 ? "" : "s"}` : `${orders.length} order${orders.length === 1 ? "" : "s"}`}
      </p>

      {orders.length === 0 ? (
        <div className="text-center py-5">
          <div style={{ fontSize: 60 }}>📦</div>
          <h4 className="mt-3">No orders yet</h4>
          <p className="text-muted">When you place an order it will show up here.</p>
          <Link to="/shop" className="btn btn-primary customer-btn">Start Shopping</Link>
        </div>
      ) : (
        <div className="card shadow-sm cust-card">
          <div className="table-responsive">
            <table className="table table-hover align-middle mb-0 cust-table">
              <thead>
                <tr>
                  <th>Order</th>
                  <th>Invoice</th>
                  <th>Date</th>
                  <th>Items</th>
                  <th>Total</th>
                  <th>Payment</th>
                  <th>Status</th>
                  <th></th>
                </tr>
              </thead>
              <tbody>
                {orders.map((o) => (
                  <tr key={o.id}>
                    <td>#{o.id}</td>
                    <td>{o.invoice_no || "INV-" + String(o.id).padStart(6, "0")}</td>
                    <td>{formatDate(o.created_at)}</td>
                    <td>{o.items_count || 0}</td>
                    <td className="fw-semibold">{formatINR(Number(o.grand_total ?? o.total_amount))}</td>
                    <td>
                      <span className={`badge ${isPaid(o.payment_status) ? "bg-success" : "bg-warning text-dark"}`}>{o.payment_status}</span>
                    </td>
                    <td><StatusBadge status={o.status} /></td>
                    <td>
                      <div className="table-actions text-nowrap">
                        <Link to={`/my-orders/${o.id}`} className="btn-table" title="View order">View</Link>
                        <Link to={`/track-order/${o.id}`} className="btn-table" title="Track order">Track</Link>
                        <button className="btn-table" onClick={() => downloadInvoice(o)} disabled={downloadingId === o.id} title="Download invoice">
                          {downloadingId === o.id ? "Generating…" : "Invoice"}
                        </button>
                        {!isPaid(o.payment_status) && (
                          <button className="btn-table btn-table-primary" onClick={() => retryPayment(o)} title="Pay now">Pay Now</button>
                        )}
                        {!isPaid(o.payment_status) && Number(wallet?.points_balance || 0) > 0 && (
                          <button className="btn-table" onClick={() => { setRedeemPoints(""); setRedeemTarget(o); }} title={`Redeem points (balance: ${wallet.points_balance})`}>
                            Redeem Points
                          </button>
                        )}
                        {CANCELABLE.includes(o.status) && (
                          <button className="btn-table btn-table-danger" onClick={() => { setCancelReason(""); setCancelTarget(o); }} title="Cancel order">Cancel</button>
                        )}
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>

            {pagination && pagination.total_pages > 1 && (
              <div className="d-flex justify-content-between align-items-center mt-3">
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
      )}

      {/* CANCEL MODAL */}
      {cancelTarget && (
        <div className="confirm-overlay" onClick={() => !cancelling && setCancelTarget(null)} role="dialog" aria-modal="true" aria-label="Cancel order">
          <div className="confirm-box" onClick={(e) => e.stopPropagation()}>
            <div className="confirm-icon">⚠️</div>
            <div className="confirm-title">Cancel Order #{cancelTarget.id}?</div>
            <div className="confirm-msg">
              This will cancel the order and restore the purchased items back to stock. This action cannot be undone.
            </div>
            <input
              className="form-control mb-3"
              placeholder="Reason (optional)"
              value={cancelReason}
              maxLength={200}
              disabled={cancelling}
              onChange={(e) => setCancelReason(e.target.value)}
            />
            <div className="confirm-actions">
              <button className="btn btn-light" disabled={cancelling} onClick={() => setCancelTarget(null)}>Keep Order</button>
              <button className="btn btn-danger" disabled={cancelling} onClick={cancelOrder}>
                {cancelling ? "Cancelling…" : "Cancel Order"}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* REDEEM POINTS MODAL */}
      {redeemTarget && (
        <div className="confirm-overlay" onClick={() => !redeeming && setRedeemTarget(null)} role="dialog" aria-modal="true" aria-label="Redeem points">
          <div className="confirm-box" onClick={(e) => e.stopPropagation()}>
            <div className="confirm-icon">🎁</div>
            <div className="confirm-title">Redeem Points</div>
            <div className="confirm-msg">
              Your balance: <strong>{wallet?.points_balance || 0} points</strong>. Points are converted to an instant discount on order #{redeemTarget.id}.
            </div>
            <input
              className="form-control mb-2"
              type="number"
              min="1"
              max={wallet?.points_balance || 0}
              placeholder="Enter points to redeem"
              value={redeemPoints}
              disabled={redeeming}
              onChange={(e) => setRedeemPoints(e.target.value)}
            />
            <div className="confirm-actions">
              <button className="btn btn-light" disabled={redeeming} onClick={() => setRedeemTarget(null)}>Cancel</button>
              <button className="btn btn-primary" disabled={redeeming} onClick={redeemOrder}>
                {redeeming ? "Applying…" : "Redeem Points"}
              </button>
            </div>
          </div>
        </div>
      )}

      <style>{`.customer-btn{border-radius:999px;} .cust-table th{font-size:12px;text-transform:uppercase;color:var(--text-muted);}`}</style>
    </div>
  );
}
