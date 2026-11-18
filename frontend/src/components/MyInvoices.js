import React, { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import api from "../lib/api";
import { formatINR, formatDateOnly } from "../lib/utils";
import { downloadInvoicePdf } from "../lib/invoice";
import { useToast } from "./ui";

export default function MyInvoices() {
  const [invoices, setInvoices] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [downloadingId, setDownloadingId] = useState(null);
  const toast = useToast();

  useEffect(() => {
    api
      .get("/invoices/my-invoices")
      .then((res) => setInvoices(Array.isArray(res.data) ? res.data : []))
      .catch(() => setError("Failed to load invoices"))
      .finally(() => setLoading(false));
  }, []);

  const downloadPdf = async (inv) => {
    if (downloadingId) return; // prevent duplicate downloads
    setDownloadingId(inv.id);
    toast.info("Generating invoice…");
    try {
      await downloadInvoicePdf(inv.order_id, `${inv.invoice_no || `INV-${String(inv.order_id).padStart(6, "0")}`}.pdf`);
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

  if (loading) return <div className="text-center py-5 text-muted">Loading invoices…</div>;
  if (error) return <div className="alert alert-danger">{error}</div>;

  return (
    <div>
      <h3 className="cust-page-title mb-1">My Invoices</h3>
      <p className="text-muted mb-4">{invoices.length} invoice{invoices.length === 1 ? "" : "s"}</p>

      {invoices.length === 0 ? (
        <div className="text-center py-5">
          <div style={{ fontSize: 60 }}>🧾</div>
          <h4 className="mt-3">No invoices yet</h4>
          <p className="text-muted">Invoices are generated when you place an order.</p>
          <Link to="/shop" className="btn btn-primary customer-btn">Shop Now</Link>
        </div>
      ) : (
        <div className="card shadow-sm cust-card">
          <div className="table-responsive">
            <table className="table table-hover align-middle mb-0 cust-table">
              <thead>
                <tr>
                  <th>Invoice #</th>
                  <th>Date</th>
                  <th>Order</th>
                  <th>Amount</th>
                  <th>Payment</th>
                  <th></th>
                </tr>
              </thead>
              <tbody>
                {invoices.map((inv) => (
                  <tr key={inv.id}>
                    <td className="fw-semibold">{inv.invoice_no}</td>
                    <td>{formatDateOnly(inv.invoice_date)}</td>
                    <td><Link to={`/my-orders/${inv.order_id}`}>#{inv.order_id}</Link></td>
                    <td className="fw-semibold">{formatINR(inv.grand_total)}</td>
                    <td>
                      <span className={`badge ${inv.payment_status === "paid" ? "bg-success" : "bg-warning text-dark"}`}>{inv.payment_status}</span>
                    </td>
                    <td>
                      <div className="table-actions text-nowrap">
                        <Link to={`/invoice/${inv.order_id}`} className="btn-table" title="View invoice">View</Link>
                        <button className="btn-table" onClick={() => downloadPdf(inv)} disabled={downloadingId === inv.id} title="Download PDF">
                          {downloadingId === inv.id ? "Generating…" : "Download"}
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      <style>{`.customer-btn{border-radius:999px;} .cust-table th{font-size:12px;text-transform:uppercase;color:var(--text-muted);} .cust-card{border:1px solid var(--border);border-radius:16px;overflow:hidden;background:var(--surface);}`}</style>
    </div>
  );
}
