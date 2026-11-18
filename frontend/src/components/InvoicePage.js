import React, { useEffect, useState } from "react";
import { useParams, Link } from "react-router-dom";
import api from "../lib/api";
import { StatusBadge } from "./OrderStatusTimeline";
import { downloadInvoicePdf } from "../lib/invoice";
import { useToast } from "./ui";

export default function InvoicePage() {
  const params = useParams();
  const targetId = params.id || params.orderId;
  const [data, setData] = useState(null);
  const [error, setError] = useState("");
  const [downloading, setDownloading] = useState(false);
  const toast = useToast();

  useEffect(() => {
    if (!targetId) return;
    api
      .get(`/orders/${targetId}`)
      .then((res) => setData(res.data))
      .catch((err) => {
        console.error("Invoice load failed", err);
        setError(err.response?.data?.error || "Failed to load invoice");
      });
  }, [targetId]);

  if (error) {
    return (
      <div className="container mt-4" style={{ maxWidth: "800px", margin: "0 auto", padding: "40px 16px" }}>
        <Link to="/my-orders" style={styles.back}>← My Orders</Link>
        <div className="alert alert-danger mt-3">{error}</div>
      </div>
    );
  }

  if (!data) {
    return (
      <div className="container mt-4" style={{ maxWidth: "800px", margin: "0 auto", padding: "40px 16px" }}>
        <h4>Loading invoice...</h4>
      </div>
    );
  }

  const { order, items } = data;

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

  // Prefer the server-reported amounts. Legacy orders are reported with their
  // stored figures and a `totals_basis` label, so recomputing here would add a
  // second time to tax that is already inside the recorded total.
  const gst = Number(order.gst || 0);
  const discount = Number(order.discount || 0);
  const subtotal = Number(order.subtotal ?? order.total_amount ?? 0);
  const isContractBasis = !order.is_legacy_totals && (order.totals_basis ?? "contract") === "contract";
  const grandTotal = Number(
    order.grand_total ?? (isContractBasis ? subtotal - discount + gst : subtotal)
  );
  const invoiceNo = order.invoice_no || `INV-${String(order.id).padStart(6, "0")}`;

  return (
    <div className="container mt-4" style={{ maxWidth: "800px", margin: "0 auto", padding: "40px 16px" }}>
      <div style={styles.toolbar}>
        <Link to="/my-orders" style={styles.back}>← My Orders</Link>
        <div>
          <button className="btn btn-secondary me-2" onClick={() => window.print()}>
            🖨 Print
          </button>
          <button className="btn btn-primary" onClick={downloadPdf} disabled={downloading}>
            {downloading ? "Generating…" : "⬇ Download PDF"}
          </button>
        </div>
      </div>

      {/* INVOICE */}
      <div className="card shadow-sm p-4" id="invoice-print">
        <div style={styles.header}>
          <div>
            <h3 style={styles.brand}>NP STORE</h3>
            <p style={styles.muted}>Tax Invoice · Kumta, Karnataka</p>
          </div>
          <div style={{ textAlign: "right" }}>
            <h5>{invoiceNo}</h5>
            <StatusBadge status={order.status} />
          </div>
        </div>

        <hr />

        <div className="row">
          <div className="col-md-6">
            <p><strong>Customer:</strong> {order.customer || order.shipping_name || "—"}</p>
            <p><strong>Payment:</strong> {order.payment_status}</p>
            {order.shipping_address && (
              <p className="small text-muted mb-0">
                <strong>Address:</strong> {order.shipping_address}, {order.shipping_city} {order.shipping_state} {order.shipping_pincode}
              </p>
            )}
          </div>
          <div className="col-md-6 text-md-end">
            <p>
              <strong>Date:</strong> {new Date(order.created_at).toLocaleDateString("en-IN")}
            </p>
            {order.shipping_mobile && (
              <p className="small text-muted"><strong>Contact:</strong> {order.shipping_mobile}</p>
            )}
          </div>
        </div>

        <table className="table table-bordered mt-3">
          <thead className="table-light">
            <tr>
              <th>Product</th>
              <th width="80">Qty</th>
              <th width="120">Price</th>
              <th width="120">Total</th>
            </tr>
          </thead>
          <tbody>
            {items.map((item) => (
              <tr key={item.id}>
                <td>{item.productName}</td>
                <td>{item.quantity}</td>
                <td>₹{Number(item.price).toFixed(2)}</td>
                <td>₹{(Number(item.price) * item.quantity).toFixed(2)}</td>
              </tr>
            ))}
          </tbody>
        </table>

        <div style={styles.totals}>
          <p>Subtotal: <span>₹,1{subtotal.toFixed(2)}</span></p>
          {discount > 0 && (
            <p>Discount: <span style={{ color: "var(--danger)" }}>− ₹,1{discount.toFixed(2)}</span></p>
          )}
          <p>GST: <span>₹,1{gst.toFixed(2)}</span></p>
          <p style={styles.grandTotal}>Grand Total: <span>₹,1{grandTotal.toFixed(2)}</span></p>
        </div>

        {!isContractBasis && (
          <p style={styles.footer}>
            Recorded under an earlier calculation basis; the amounts above are shown
            exactly as stored and have not been recalculated.
          </p>
        )}

        <hr />
        <p style={styles.footer}>Thank you for shopping with NP Store.</p>
      </div>
    </div>
  );
}

const styles = {
  toolbar: {
    display: "flex",
    justifyContent: "space-between",
    alignItems: "center",
    marginBottom: "20px",
  },
  back: { color: "var(--brand)", textDecoration: "none", fontWeight: 600 },
  header: {
    display: "flex",
    justifyContent: "space-between",
    alignItems: "flex-start",
  },
  brand: { margin: 0, fontWeight: 700 },
  muted: { color: "var(--text-muted)", fontSize: "13px" },
  totals: { textAlign: "right", maxWidth: "300px", marginLeft: "auto" },
  grandTotal: { fontWeight: 700, fontSize: "18px", borderTop: "1px solid var(--border)", paddingTop: "8px", color: "var(--text)" },
  footer: { textAlign: "center", color: "var(--text-muted)", marginTop: "20px" },
};
