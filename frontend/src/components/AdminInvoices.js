import React, { useEffect, useState } from "react";
import api from "../lib/api";
import { downloadInvoicePdf } from "../lib/invoice";
import { useToast } from "./ui";

export default function AdminInvoices() {
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(true);
  const [detail, setDetail] = useState(null);
  const [detailLoading, setDetailLoading] = useState(false);
  const [downloading, setDownloading] = useState(false);
  const toast = useToast();

  const load = async () => {
    setLoading(true);
    try {
      const res = await api.get("/dms/invoices");
      setRows(Array.isArray(res.data) ? res.data : []);
    } catch (err) {
      console.error("Load invoices error:", err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    load();
  }, []);

  const openDetail = async (id) => {
    setDetailLoading(true);
    setDetail(null);
    try {
      const res = await api.get(`/dms/invoices/${id}`);
      setDetail(res.data);
    } catch (err) {
      alert(err.response?.data?.error || "Failed to load invoice");
    } finally {
      setDetailLoading(false);
    }
  };

  const downloadPdf = async (orderId) => {
    if (downloading) return; // prevent duplicate downloads
    setDownloading(true);
    toast.info("Generating invoice…");
    try {
      await downloadInvoicePdf(orderId, `invoice-${orderId}.pdf`);
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

  const fmt = (n) => `₹${Number(n || 0).toFixed(2)}`;
  const fmtDate = (d) => (d ? new Date(d).toLocaleDateString("en-IN") : "");

  return (
    <div className="container-fluid py-4">
      <h2 className="mb-4">Invoices</h2>

      {loading ? (
        <div className="loading">Loading...</div>
      ) : (
        <table className="table table-striped shadow-sm">
          <thead>
            <tr>
              <th>Invoice No</th>
              <th>Date</th>
              <th>Order #</th>
              <th>Retailer</th>
              <th>Grand Total</th>
              <th>Payment</th>
              <th>View</th>
            </tr>
          </thead>
          <tbody>
            {rows.length === 0 ? (
              <tr>
                <td colSpan="7" className="text-muted text-center">
                  No invoices generated yet.
                </td>
              </tr>
            ) : (
              rows.map((i) => (
                <tr key={i.id}>
                  <td>{i.invoice_no}</td>
                  <td>{fmtDate(i.invoice_date)}</td>
                  <td>{i.order_id}</td>
                  <td>{i.retailer_name || i.customer_name || "—"}</td>
                  <td>{fmt(i.grand_total)}</td>
                  <td>
                    <span className={`status ${i.payment_status || ""}`}>
                      {i.payment_status || "pending"}
                    </span>
                  </td>
                  <td>
                    <button
                      className="btn btn-sm btn-outline-primary"
                      onClick={() => openDetail(i.id)}
                    >
                      View
                    </button>
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      )}

      {detailLoading && <div className="loading">Loading invoice...</div>}

      {detail && (
        <div className="card p-4 shadow-sm mt-4">
          <div className="d-flex justify-content-between align-items-center">
            <h4>{detail.invoice.invoice_no}</h4>
            <div className="d-flex gap-2">
              <button
                className="btn btn-sm btn-secondary"
                onClick={() => window.print()}
              >
                🖨 Print
              </button>
              <button
                className="btn btn-sm btn-primary"
                onClick={() => downloadPdf(detail.invoice.order_id)}
                disabled={downloading}
              >
                {downloading ? "Generating…" : "⬇ Download PDF"}
              </button>
              <button
                className="btn btn-sm btn-outline-secondary"
                onClick={() => setDetail(null)}
              >
                Close
              </button>
            </div>
          </div>

          <div className="row g-3 mt-1">
            <div className="col-md-6">
              <div className="text-muted small">Billed To</div>
              <strong>{detail.invoice.retailer_name || detail.invoice.customer_name}</strong>
              <div>{detail.invoice.retailer_shop || ""}</div>
              {detail.invoice.retailer_address ? (
                <div className="small">{detail.invoice.retailer_address}</div>
              ) : null}
              {detail.invoice.retailer_city ? (
                <div className="small">{detail.invoice.retailer_city}</div>
              ) : null}
              {detail.invoice.retailer_gst ? (
                <div className="small">GST: {detail.invoice.retailer_gst}</div>
              ) : null}
            </div>
            <div className="col-md-6 text-md-end">
              <div className="small text-muted">
                Order Date: {fmtDate(detail.invoice.order_date)}
              </div>
              <div className="small text-muted">
                Salesman: {detail.invoice.salesman || "—"}
              </div>
              <div className="small text-muted">
                Payment: {detail.invoice.payment_status || "pending"}
              </div>
            </div>
          </div>

          <table className="table table-sm mt-3">
            <thead>
              <tr>
                <th>Item</th>
                <th>SKU</th>
                <th className="text-end">Qty</th>
                <th className="text-end">Rate</th>
                <th className="text-end">GST %</th>
                <th className="text-end">Amount</th>
              </tr>
            </thead>
            <tbody>
              {detail.items.map((it) => (
                <tr key={it.id}>
                  <td>{it.description}</td>
                  <td>{it.sku}</td>
                  <td className="text-end">{it.quantity}</td>
                  <td className="text-end">{fmt(it.rate)}</td>
                  <td className="text-end">{it.gst_percent}</td>
                  <td className="text-end">{fmt(it.amount)}</td>
                </tr>
              ))}
              <tr>
                <td colSpan="5" className="text-end">
                  Subtotal
                </td>
                <td className="text-end">{fmt(detail.invoice.subtotal)}</td>
              </tr>
              <tr>
                <td colSpan="5" className="text-end">
                  Discount
                </td>
                <td className="text-end">− {fmt(detail.invoice.discount)}</td>
              </tr>
              <tr>
                <td colSpan="5" className="text-end">
                  Taxable
                </td>
                <td className="text-end">{fmt(detail.invoice.taxable_amount)}</td>
              </tr>
              <tr>
                <td colSpan="5" className="text-end">
                  GST
                </td>
                <td className="text-end">{fmt(detail.invoice.gst_amount)}</td>
              </tr>
              <tr className="table-primary">
                <td colSpan="5" className="text-end fw-bold">
                  Grand Total
                </td>
                <td className="text-end fw-bold">{fmt(detail.invoice.grand_total)}</td>
              </tr>
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}