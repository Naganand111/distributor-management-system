import React, { useEffect, useState } from "react";
import api from "../lib/api";
import { useToast } from "./ui";

export default function AdminReturns() {
  const [list, setList] = useState([]);
  const [loading, setLoading] = useState(true);
  const [detail, setDetail] = useState(null);
  const toast = useToast();

  const load = async () => {
    setLoading(true);
    try {
      const res = await api.get("/returns");
      setList(Array.isArray(res.data) ? res.data : []);
    } catch (err) {
      console.error("Load returns error:", err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { load(); }, []);

  const openDetail = async (id) => {
    const res = await api.get(`/returns/${id}`);
    setDetail(res.data);
  };

  const changeStatus = async (status) => {
    try {
      await api.put(`/returns/${detail.return.id}/status`, { status });
      setDetail((d) => ({ ...d, return: { ...d.return, status } }));
      load();
    } catch (err) {
      toast.error(err.response?.data?.error || "Failed to update");
    }
  };

  const fmt = (n) => `₹${Number(n || 0).toLocaleString("en-IN", { maximumFractionDigits: 2 })}`;

  const statusMap = {
    requested: "warning", approved: "info", rejected: "danger",
    received: "success", refunded: "dark",
  };

  return (
    <div className="container-fluid py-4">
      <div className="d-flex justify-content-between align-items-center mb-4">
        <h2 className="mb-0">Returns</h2>
        <button className="btn btn-outline-secondary" onClick={load}>Refresh</button>
      </div>

      {loading ? (
        <div className="loading">Loading...</div>
      ) : (
        <div className="card shadow-sm">
          <div className="table-responsive">
            <table className="table table-striped mb-0 align-middle">
              <thead>
                <tr>
                  <th>#</th><th>Return No</th><th>Type</th><th>Party</th>
                  <th>Amount</th><th>Status</th><th>Date</th><th></th>
                </tr>
              </thead>
              <tbody>
                {list.map((r) => (
                  <tr key={r.id}>
                    <td>{r.id}</td>
                    <td>{r.return_number}</td>
                    <td>{r.return_type}</td>
                    <td>{r.retailer_name || r.supplier_name || "—"}</td>
                    <td>{fmt(r.total_amount)}</td>
                    <td>
                      <span className={`badge bg-${statusMap[r.status] || "secondary"}`}>{r.status}</span>
                    </td>
                    <td>{new Date(r.created_at).toLocaleDateString()}</td>
                    <td className="text-end">
                      <button className="btn btn-sm btn-outline-primary" onClick={() => openDetail(r.id)}>
                        View
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            {!list.length && <p className="p-3 text-muted mb-0">No returns yet.</p>}
          </div>
        </div>
      )}

      {detail && (
        <div style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,.5)", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 999 }}
          onClick={() => setDetail(null)}>
          <div className="card p-4 shadow" style={{ width: 720, maxHeight: "90vh", overflow: "auto" }} onClick={(e) => e.stopPropagation()}>
            <div className="d-flex justify-content-between mb-3">
              <h5 className="mb-0">{detail.return.return_number}</h5>
              <span className={`badge bg-${statusMap[detail.return.status] || "secondary"}`}>{detail.return.status}</span>
            </div>
            <p className="text-muted small mb-3">
              Type: {detail.return.return_type} · Retailer: {detail.return.retailer_name || "—"}
              {" "}· Supplier: {detail.return.supplier_name || "—"}
              {" "}· Reason: {detail.return.reason || "—"}
              {" "}· Total: <strong>{fmt(detail.return.total_amount)}</strong>
            </p>

            <table className="table table-sm mb-3">
              <thead>
                <tr><th>Product</th><th>Qty</th><th>Price</th><th>Total</th><th>Condition</th></tr>
              </thead>
              <tbody>
                {detail.items.map((it) => (
                  <tr key={it.id}>
                    <td>{it.product_name}</td>
                    <td>{it.quantity}</td>
                    <td>{fmt(it.price)}</td>
                    <td>{fmt(it.price * it.quantity)}</td>
                    <td><span className="badge bg-secondary">{it.item_condition}</span></td>
                  </tr>
                ))}
              </tbody>
            </table>

            <div className="d-flex flex-wrap justify-content-end gap-2">
              {detail.return.status === "requested" && (
                <>
                  <button className="btn btn-success" onClick={() => changeStatus("approved")}>Approve</button>
                  <button className="btn btn-danger" onClick={() => changeStatus("rejected")}>Reject</button>
                </>
              )}
              {detail.return.status === "approved" && (
                <button className="btn btn-primary" onClick={() => changeStatus("received")}>
                  Receive (Restock)
                </button>
              )}
              {detail.return.status === "received" && (
                <button className="btn btn-dark" onClick={() => changeStatus("refunded")}>Mark Refunded</button>
              )}
              <button className="btn btn-light" onClick={() => setDetail(null)}>Close</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
