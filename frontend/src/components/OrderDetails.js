import React, { useEffect, useState } from "react";
import { useParams, Link } from "react-router-dom";
import api from "../lib/api";
import { formatINR, formatDate } from "../lib/utils";
import OrderStatusTimeline, { StatusBadge } from "./OrderStatusTimeline";
import { downloadInvoicePdf } from "../lib/invoice";
import { useToast } from "./ui";

const CANCELABLE = ["pending", "processing", "confirmed"];

export default function OrderDetails() {
  const { id } = useParams();
  const [data, setData] = useState(null);
  const [error, setError] = useState("");
  const [downloading, setDownloading] = useState(false);
  const [cancelOpen, setCancelOpen] = useState(false);
  const [cancelReason, setCancelReason] = useState("");
  const [cancelling, setCancelling] = useState(false);
  const toast = useToast();

  useEffect(() => {
    api
      .get(`/orders/${id}`)
      .then((res) => setData(res.data))
      .catch((err) => setError(err.response?.data?.error || "Could not load order"))
      .finally(() => {});
  }, [id]);

  const cancelOrder = async () => {
    setCancelling(true);
    toast.info("Cancelling order…");
    try {
      const res = await api.post(`/orders/${id}/cancel`, { reason: cancelReason });
      setData((prev) => ({
        ...prev,
        order: { ...prev.order, status: res.data.status || "cancelled" },
      }));
      setCancelOpen(false);
      setCancelReason("");
      toast.success(`Order #${id} cancelled successfully`);
    } catch (err) {
      toast.error(err.response?.data?.error || "Unable to cancel order. Please try again.");
    } finally {
      setCancelling(false);
    }
  };

  if (error) return <div className="alert alert-danger">{error}</div>;

  if (!data) {
    return <div className="text-center py-5 text-muted">Loading order…</div>;
  }

  const { order, items, history } = data;
  // Server-authoritative amounts. The server reports the stored figures for
  // historical orders and labels them, so nothing here re-prices an old order.
  const itemsSum = items.reduce((s, i) => s + Number(i.price) * Number(i.quantity), 0);
  const subtotal = Number(order.subtotal ?? itemsSum);
  const discount = Number(order.discount || 0);
  const gst = Number(order.gst || 0);
  const grandTotal = Number(order.grand_total ?? subtotal - discount + gst);
  // Historical orders created before server-side pricing can carry a stored
  // subtotal that no longer matches their line items. Surface it, never hide it.
  const totalsMismatch = Math.abs(itemsSum - subtotal) > 0.01;
  // The server classifies the money basis of every order ("contract" for orders
  // created under the current rules, a legacy label otherwise).
  const totalsBasis = order.totals_basis || "contract";
  const isLegacyTotals = order.is_legacy_totals === true || totalsBasis !== "contract";
  const basisNote = {
    gst_included_in_total_amount:
      "the recorded amount already includes GST, so it is not added again below",
    no_tax_recorded: "no GST was charged on this order",
    unclassified_tax_difference:
      "the recorded tax amount does not match any known calculation basis",
  }[totalsBasis];
  const invoiceNo = order.invoice_no || `INV-${String(order.id).padStart(6, "0")}`;
  const isPaid = order.payment_status === "paid";

  const downloadPdf = async () => {
    if (downloading) return; // prevent duplicate downloads
    setDownloading(true);
    toast.info("Generating invoice…");
    try {
      await downloadInvoicePdf(order.id, `${invoiceNo}.pdf`);
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
      setDownloading(false);
    }
  };

  return (
    <div>
      <nav className="mb-3"><Link to="/my-orders" className="text-decoration-none">← My Orders</Link></nav>

      {/* HEADER */}
      <div className="card shadow-sm cust-card mb-4">
        <div className="card-body">
          <div className="card-header cust-card-header" style={{ margin: "-16px -16px 16px" }}>
            <span>Order #{order.id}</span>
            <span className="d-flex gap-2 align-items-center">
              <StatusBadge status={order.status} />
              <span className={`badge ${isPaid ? "bg-success" : "bg-warning text-dark"}`}>{order.payment_status}</span>
            </span>
          </div>

          <div className="row g-3">
            <div className="col-md-6">
              <div className="text-muted small">Invoice Number</div>
              <div className="fw-semibold">{invoiceNo}</div>
            </div>
            <div className="col-md-6 text-md-end">
              <div className="text-muted small">Placed On</div>
              <div className="fw-semibold">{formatDate(order.created_at)}</div>
            </div>

            <div className="col-md-6">
              <div className="text-muted small">Customer</div>
              <div className="fw-semibold">{order.customer || order.shipping_name || "—"}</div>
              {(order.shipping_mobile || order.shipping_address) && (
                <div className="small text-muted">
                  {order.shipping_mobile}
                  {order.shipping_address && (
                    <div>{order.shipping_address}, {order.shipping_city} {order.shipping_state} {order.shipping_pincode}</div>
                  )}
                </div>
              )}
            </div>

            <div className="col-md-6 text-md-end">
              <div className="text-muted small">Payment Method</div>
              <div className="fw-semibold">{order.payment_method || "—"}</div>
            </div>
          </div>

          {/* TIMELINE */}
          <OrderStatusTimeline status={order.status} history={history} />
        </div>
      </div>

      {/* ITEMS */}
      <div className="card shadow-sm cust-card mb-3">
        <div className="table-responsive">
          <table className="table align-middle mb-0 cust-table">
            <thead>
              <tr>
                <th>Product</th>
                <th width="80">Qty</th>
                <th width="120">Price</th>
                <th width="130">Total</th>
              </tr>
            </thead>
            <tbody>
              {items.map((item) => (
                <tr key={item.id}>
                  <td>{item.productName}</td>
                  <td>{item.quantity}</td>
                  <td>{formatINR(item.price)}</td>
                  <td>{formatINR(Number(item.price) * item.quantity)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {/* TOTALS */}
      <div className="card shadow-sm cust-card mb-4">
        <div className="card-body" style={{ maxWidth: 360, marginLeft: "auto" }}>
          <div className="d-flex justify-content-between"><span>Subtotal</span><span>{formatINR(subtotal)}</span></div>
          {discount > 0 && <div className="d-flex justify-content-between"><span>Discount</span><span className="text-danger">− {formatINR(discount)}</span></div>}
          <div className="d-flex justify-content-between"><span>GST</span><span>{formatINR(gst)}</span></div>
          <hr className="my-2" />
          <div className="d-flex justify-content-between fw-bold fs-5"><span>Grand Total</span><span>{formatINR(grandTotal)}</span></div>
          <div className="d-flex justify-content-between small text-muted"><span>Paid Amount</span><span>{formatINR(order.paid_amount || 0)}</span></div>
          {!isPaid && (
            <div className="d-flex justify-content-between small text-warning"><span>Due Amount</span><span>{formatINR(grandTotal - (Number(order.paid_amount) || 0))}</span></div>
          )}
          {isLegacyTotals && (
            <div className="small text-warning mt-2">
              This order was recorded under an earlier calculation basis{" "}
              {basisNote ? `(${basisNote})` : ""}. The amounts shown are exactly
              as they were stored and have not been recalculated.
            </div>
          )}
          {totalsMismatch && (
            <div className="small text-warning mt-2">
              This order was placed before server-side pricing. Its recorded subtotal
              ({formatINR(subtotal)}) differs from its line items ({formatINR(itemsSum)}).
              Contact support if the amount looks wrong.
            </div>
          )}
        </div>
      </div>

      {/* BUTTONS */}
      <div className="d-flex gap-2 flex-wrap mb-4">
        <Link to={`/track-order/${order.id}`} className="btn btn-primary cum-btn">Track Order</Link>
        <button className="btn btn-outline-primary cum-btn" onClick={downloadPdf} disabled={downloading}>
          {downloading ? "Generating…" : "Download Invoice"}
        </button>
        {CANCELABLE.includes(order.status) && (
          <button
            className="btn btn-outline-danger cum-btn"
            onClick={() => { setCancelReason(""); setCancelOpen(true); }}
          >
            Cancel Order
          </button>
        )}
      </div>

      {/* CANCEL MODAL */}
      {cancelOpen && (
        <div className="confirm-overlay" onClick={() => !cancelling && setCancelOpen(false)} role="dialog" aria-modal="true" aria-label="Cancel order">
          <div className="confirm-box" onClick={(e) => e.stopPropagation()}>
            <div className="confirm-icon">⚠️</div>
            <div className="confirm-title">Cancel Order #{order.id}?</div>
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
              <button className="btn btn-light" disabled={cancelling} onClick={() => setCancelOpen(false)}>Keep Order</button>
              <button className="btn btn-danger" disabled={cancelling} onClick={cancelOrder}>
                {cancelling ? "Cancelling…" : "Cancel Order"}
              </button>
            </div>
          </div>
        </div>
      )}

      <style>{`.cum-btn{border-radius:999px;} .cust-table th{font-size:12px;text-transform:uppercase;color:var(--text-muted);} .cust-card{border:1px solid var(--border);border-radius:16px;overflow:hidden;background:var(--surface);} .cust-card-header{background:var(--surface-2);padding:14px 18px;display:flex;justify-content:space-between;align-items:center;font-weight:700;border-bottom:1px solid var(--border);color:var(--text);}`}</style>
    </div>
  );
}
