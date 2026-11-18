import React, { useEffect, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import api from "../lib/api";
import { formatINR, formatDateOnly } from "../lib/utils";
import { downloadInvoicePdf } from "../lib/invoice";
import { useToast } from "./ui";

export default function AdminGlobalSearch() {
  const [tab, setTab] = useState("search");
  const [query, setQuery] = useState("");
  const [items, setItems] = useState([]);
  const [docs, setDocs] = useState([]);
  const [searched, setSearched] = useState(false);
  const [loading, setLoading] = useState(false);
  const [role, setRole] = useState("admin");
  const navigate = useNavigate();
  const toast = useToast();
  const [downloading, setDownloading] = useState(null);

  useEffect(() => {
    const u = localStorage.getItem("user");
    try { if (u) setRole(JSON.parse(u).role); } catch { /* ignore */ }
  }, []);

  const search = async () => {
    if (!query.trim()) return;
    setSearched(true);
    setLoading(true);
    try {
      const res = await api.get(`/global-search?q=${encodeURIComponent(query.trim())}`);
      setItems(Array.isArray(res.data.items) ? res.data.items : []);
    } catch (err) {
      console.error("Search:", err);
    } finally {
      setLoading(false);
    }
  };

  const loadDocs = async () => {
    try {
      const res = await api.get("/documents");
      setDocs(Array.isArray(res.data.data) ? res.data.data : []);
    } catch (err) {
      console.error("Load documents:", err);
    }
  };

  useEffect(() => { if (tab === "docs") loadDocs(); }, [tab]);

  const downloadPdf = async (o) => {
    if (downloading) return; // prevent duplicate downloads
    setDownloading(o);
    toast.info("Generating invoice…");
    try {
      await downloadInvoicePdf(o, `invoice-${o}.pdf`);
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
      setDownloading(null);
    }
  };

  const openResult = (it) => {
    if (it.type === "order") navigate(`/admin/order-tracking`);
    else if (it.type === "product") navigate(`/admin/products`);
    else if (it.type === "retailer") navigate(`/admin/retailers`);
    else if (it.type === "invoice") navigate(`/admin/invoices`);
    else if (it.type === "purchase_order") navigate(`/admin/purchase-orders`);
  };

  const typeBadge = {
    order: "bg-dark", product: "bg-primary", invoice: "bg-success", retailer: "bg-info text-dark",
    purchase_order: "bg-warning text-dark", return: "bg-secondary", supplier: "bg-secondary",
  };

  return (
    <div className="container-fluid">
      <h2 className="mb-3">Search &amp; Documents</h2>

      <ul className="nav nav-pills mb-3">
        {[["search", "Global Search"], ["docs", "Documents"]].map(([k, l]) => (
          <li className="nav-item" key={k}>
            <button className={`nav-link ${tab === k ? "active" : ""}`} style={tab === k ? { background: "var(--brand)" } : {}} onClick={() => setTab(k)}>{l}</button>
          </li>
        ))}
      </ul>

      {tab === "search" ? (
        <>
          <div className="input-group mb-3" style={{ maxWidth: 640 }}>
            <input className="form-control" placeholder="Search orders, products, invoices, retailers, POs, returns…"
              value={query} onChange={(e) => setQuery(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && search()} />
            <button className="btn btn-dark" onClick={search}>Search</button>
          </div>

          {loading ? (
            <div className="loading">Searching...</div>
          ) : searched ? (
            <div className="card shadow-sm">
              <div className="card-header bg-white fw-semibold">{items.length} result{items.length === 1 ? "" : "s"} for "{query}"</div>
              <div className="list-group list-group-flush">
                {items.map((it, i) => (
                  <div key={i} className="list-group-item d-flex justify-content-between align-items-center">
                    <div>
                      <span className={`badge ${typeBadge[it.type] || "bg-secondary"} me-2`}>{it.type}</span>
                      <span className="fw-semibold">{it.title}</span>
                      <div className="text-muted small">{it.subtitle}</div>
                    </div>
                    <button className="btn btn-sm btn-outline-secondary" onClick={() => openResult(it)}>Open</button>
                  </div>
                ))}
                {!items.length && <div className="list-group-item text-muted">No results found.</div>}
              </div>
            </div>
          ) : (
            <p className="text-muted">Type a keyword to search across the system.</p>
          )}

          {role === "customer" && (
            <div className="card mt-3 bg-light">
              <div className="card-body">
                <div className="fw-semibold mb-1">Customer documents</div>
                <p className="text-muted small mb-0">Your invoices are available under the Documents tab.</p>
                <Link to={role === "admin" ? "/admin/global-search?tab=docs" : "/documents"} className="btn btn-sm btn-primary mt-2">View my documents</Link>
              </div>
            </div>
          )}
        </>
      ) : (
        <div className="card shadow-sm">
          <div className="card-header bg-white fw-semibold">
            {role === "admin" ? "All Invoices & Documents" : "My Invoices & Documents"} ({docs.length})
          </div>
          <div className="table-responsive">
            <table className="table table-striped mb-0 align-middle">
              <thead>
                <tr><th>Document</th><th>Type</th><th>Order</th><th>Date</th><th>Amount</th><th>Status</th><th>Retailer</th><th></th></tr>
              </thead>
              <tbody>
                {docs.map((d) => (
                  <tr key={d.id}>
                    <td className="fw-semibold">{d.invoice_no}</td>
                    <td><span className="badge bg-success">{d.type}</span></td>
                    <td>#{d.order_id}</td>
                    <td>{formatDateOnly(d.invoice_date)}</td>
                    <td>{formatINR(d.grand_total)}</td>
                    <td><span className={`badge ${d.payment_status === "paid" ? "bg-success" : "bg-warning text-dark"}`}>{d.payment_status}</span></td>
                    <td>{d.retailer_name || "—"}</td>
                    <td>
                      <button className="btn btn-sm btn-outline-primary" onClick={() => downloadPdf(d.order_id)} disabled={downloading === d.order_id}>
                        {downloading === d.order_id ? "Generating…" : "PDF"}
                      </button>
                    </td>
                  </tr>
                ))}
                {!docs.length && <tr><td colSpan="8" className="text-muted p-3">No documents found.</td></tr>}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}
